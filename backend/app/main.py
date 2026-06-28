from datetime import datetime, timezone
from contextlib import asynccontextmanager
import asyncio
import os
import time

from fastapi import FastAPI, Depends, HTTPException, status, Header, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, List

import aiofiles
import httpx
import json

from .database import get_db, init_db
from .models import User, Controller, Device, DeviceData, Config, Threshold
from .mqtt_service import mqtt_service
from .mqtt_broker import embedded_broker
from .ai_service import ai_service
from .schemas import (
    UserRegister, UserLogin, UserResponse, SessionResponse,
    ControllerCreate, ControllerUpdate, ControllerResponse,
    DeviceCreate, DeviceUpdate, DeviceResponse,
    DeviceDataResponse, DeviceHealthResponse, MQTTPublish,
    ConfigCreate, ConfigUpdate, ConfigResponse,
    PasswordChange, AIInsightRequest, AIInsightResponse,
    ThresholdCreate, ThresholdUpdate, ThresholdResponse,
)
from .auth import (
    create_user, authenticate_user, create_session,
    get_user_by_session, delete_session, hash_password, verify_password,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await embedded_broker.start(
        host=os.getenv("MQTT_HOST", "0.0.0.0"),
        port=int(os.getenv("MQTT_PORT", "1883")),
    )
    mqtt_service.start(
        host="127.0.0.1",
        port=int(os.getenv("MQTT_PORT", "1883")),
        username=os.getenv("MQTT_USER") or None,
        password=os.getenv("MQTT_PASSWORD") or None,
    )
    yield
    mqtt_service.stop()
    await embedded_broker.stop()


app = FastAPI(title="FastIOT", version="1.0.0", lifespan=lifespan)

ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def get_current_user(
    authorization: str = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    session_id = authorization.split(" ", 1)[1]
    user = await get_user_by_session(db, session_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    return user


async def verify_device_owner(device_id: int, user: User, db: AsyncSession) -> Device:
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    controller = await db.get(Controller, device.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


async def check_device_name_unique(controller_id: int, name: str, exclude_id: Optional[int], db: AsyncSession):
    stmt = select(Device).where(
        Device.controller_id == controller_id,
        Device.name == name,
    )
    if exclude_id is not None:
        stmt = stmt.where(Device.id != exclude_id)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Device name already exists in this controller")


@app.post("/api/register", response_model=SessionResponse)
async def register(payload: UserRegister, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(User).where((User.username == payload.username) | (User.email == payload.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username or email already exists")
    user = await create_user(db, payload.username, payload.email, payload.password)
    session = await create_session(db, user)
    return SessionResponse(
        session_id=session.session_id,
        user=UserResponse.model_validate(user),
    )


@app.post("/api/login", response_model=SessionResponse)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    session = await create_session(db, user)
    return SessionResponse(
        session_id=session.session_id,
        user=UserResponse.model_validate(user),
    )


@app.post("/api/logout")
async def logout(
    authorization: str = Header(None),
    db: AsyncSession = Depends(get_db),
):
    if authorization and authorization.startswith("Bearer "):
        session_id = authorization.split(" ", 1)[1]
        await delete_session(db, session_id)
    return {"message": "Logged out"}


@app.get("/api/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse.model_validate(user)


@app.put("/api/users/password")
async def change_password(
    payload: PasswordChange,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"message": "Password changed"}


@app.delete("/api/users/account")
async def delete_account(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(user)
    await db.commit()
    return {"message": "Account deleted"}


@app.post("/api/controllers", response_model=ControllerResponse)
async def register_controller(
    payload: ControllerCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = Controller(
        user_id=user.id,
        name=payload.name,
        mqtt_topic=payload.mqtt_topic,
        description=payload.description,
    )
    db.add(controller)
    await db.commit()
    await db.refresh(controller)
    return ControllerResponse.model_validate(controller)


@app.get("/api/controllers", response_model=list[ControllerResponse])
async def list_controllers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Controller).where(Controller.user_id == user.id))
    controllers = result.scalars().all()
    return [ControllerResponse.model_validate(c) for c in controllers]


@app.put("/api/controllers/{controller_id}", response_model=ControllerResponse)
async def update_controller(
    controller_id: int,
    payload: ControllerUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = await db.get(Controller, controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Controller not found")
    if payload.name is not None:
        controller.name = payload.name
    if payload.mqtt_topic is not None:
        controller.mqtt_topic = payload.mqtt_topic
    if payload.description is not None:
        controller.description = payload.description
    await db.commit()
    await db.refresh(controller)
    return ControllerResponse.model_validate(controller)


ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

@app.post("/api/controllers/{controller_id}/image")
async def upload_controller_image(
    controller_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = await db.get(Controller, controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Controller not found")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Invalid image type. Allowed: jpg, jpeg, png, gif, webp")

    # Delete old image if exists
    if controller.image:
        old_path = os.path.join(ASSETS_DIR, os.path.basename(controller.image))
        if os.path.exists(old_path):
            os.remove(old_path)

    filename = f"{controller.name}_{int(time.time() * 1000)}{ext}"
    dest = os.path.join(ASSETS_DIR, filename)
    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())

    controller.image = f"/assets/{filename}"
    await db.commit()
    await db.refresh(controller)
    return ControllerResponse.model_validate(controller)


@app.delete("/api/controllers/{controller_id}")
async def delete_controller(
    controller_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = await db.get(Controller, controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Controller not found")
    if controller.image:
        old_path = os.path.join(ASSETS_DIR, os.path.basename(controller.image))
        if os.path.exists(old_path):
            os.remove(old_path)
    await db.delete(controller)
    await db.commit()
    return {"message": "Controller deleted"}


@app.post("/api/devices", response_model=DeviceResponse)
async def register_device(
    payload: DeviceCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = await db.get(Controller, payload.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Controller not found")
    await check_device_name_unique(payload.controller_id, payload.name, None, db)
    device = Device(
        controller_id=payload.controller_id,
        name=payload.name,
        device_type=payload.device_type,
        unit=payload.unit,
        threshold_read_route=payload.threshold_read_route,
        threshold_update_route=payload.threshold_update_route,
        threshold_method=payload.threshold_method or "GET",
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return DeviceResponse.model_validate(device)


@app.get("/api/devices", response_model=list[DeviceResponse])
async def list_devices(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    controller_id: Optional[int] = None,
):
    stmt = select(Device).join(Controller).where(Controller.user_id == user.id)
    if controller_id is not None:
        stmt = stmt.where(Device.controller_id == controller_id)
    result = await db.execute(stmt)
    devices = result.scalars().all()
    return [DeviceResponse.model_validate(d) for d in devices]


@app.put("/api/devices/{device_id}", response_model=DeviceResponse)
async def update_device(
    device_id: int,
    payload: DeviceUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await verify_device_owner(device_id, user, db)
    new_name = payload.name if payload.name is not None else device.name
    await check_device_name_unique(device.controller_id, new_name, device.id if payload.name is not None else device.id, db)
    if payload.name is not None:
        device.name = payload.name
    if payload.device_type is not None:
        device.device_type = payload.device_type
    if payload.unit is not None:
        device.unit = payload.unit
    if payload.threshold_read_route is not None:
        device.threshold_read_route = payload.threshold_read_route
    if payload.threshold_update_route is not None:
        device.threshold_update_route = payload.threshold_update_route
    if payload.threshold_method is not None:
        device.threshold_method = payload.threshold_method
    await db.commit()
    await db.refresh(device)
    return DeviceResponse.model_validate(device)


@app.delete("/api/devices/{device_id}")
async def delete_device(
    device_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await verify_device_owner(device_id, user, db)
    await db.delete(device)
    await db.commit()
    return {"message": "Device deleted"}


@app.get("/api/devices/{device_id}/data", response_model=list[DeviceDataResponse])
async def get_device_data(
    device_id: int,
    limit: int = 1000,
    offset: int = 0,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await verify_device_owner(device_id, user, db)
    result = await db.execute(
        select(DeviceData)
        .where(DeviceData.device_id == device_id)
        .order_by(DeviceData.timestamp.desc())
        .offset(offset)
        .limit(limit)
    )
    return [DeviceDataResponse.model_validate(d) for d in result.scalars().all()]


HEALTH_WINDOW_SECONDS = 5 * 60
WARNING_WINDOW_SECONDS = 30 * 60


@app.get("/api/devices/health", response_model=list[DeviceHealthResponse])
async def device_health(
    controller_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = await db.get(Controller, controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Controller not found")

    devices_result = await db.execute(
        select(Device).where(Device.controller_id == controller_id)
    )
    devices = devices_result.scalars().all()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    out = []

    for device in devices:
        data_result = await db.execute(
            select(DeviceData)
            .where(DeviceData.device_id == device.id)
            .order_by(DeviceData.timestamp.desc(), DeviceData.id.desc())
            .limit(1)
        )
        latest_data = data_result.scalar_one_or_none()

        if latest_data is None:
            status = "no_data"
            last_value = None
            last_value_str = None
            last_timestamp = None
        else:
            diff = (now - latest_data.timestamp).total_seconds()
            if diff <= HEALTH_WINDOW_SECONDS:
                status = "healthy"
            elif diff <= WARNING_WINDOW_SECONDS:
                status = "warning"
            else:
                status = "critical"
            last_value = latest_data.value
            last_value_str = latest_data.value_str
            last_timestamp = latest_data.timestamp

        out.append(DeviceHealthResponse(
            device_id=device.id,
            device_name=device.name,
            device_type=device.device_type,
            unit=device.unit,
            last_value=last_value,
            last_value_str=last_value_str,
            last_timestamp=last_timestamp,
            status=status,
        ))

    return out


@app.get("/api/configs", response_model=list[ConfigResponse])
async def list_configs(
    controller_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Config).join(Controller).where(Controller.user_id == user.id)
    if controller_id is not None:
        stmt = stmt.where(Config.controller_id == controller_id)
    result = await db.execute(stmt)
    configs = result.scalars().all()
    return [ConfigResponse.model_validate(c) for c in configs]


@app.post("/api/configs", response_model=ConfigResponse)
async def create_config(
    payload: ConfigCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = await db.get(Controller, payload.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Controller not found")
    config = Config(
        controller_id=payload.controller_id,
        name=payload.name,
        read_route=payload.read_route,
        update_route=payload.update_route,
        method=payload.method or "GET",
        possible_values=payload.possible_values,
        value=payload.value or "",
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)

    if not payload.value and config.read_route:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(config.read_route)
                config.value = resp.text.strip()
                await db.commit()
                await db.refresh(config)
        except Exception:
            pass

    return ConfigResponse.model_validate(config)


@app.put("/api/configs/{config_id}", response_model=ConfigResponse)
async def update_config(
    config_id: int,
    payload: ConfigUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    config = await db.get(Config, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    controller = await db.get(Controller, config.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Config not found")
    if payload.name is not None:
        config.name = payload.name
    if payload.read_route is not None:
        config.read_route = payload.read_route
    if payload.update_route is not None:
        config.update_route = payload.update_route
    if payload.method is not None:
        config.method = payload.method
    if payload.value is not None:
        config.value = payload.value
    if payload.possible_values is not None:
        config.possible_values = payload.possible_values
    await db.commit()
    await db.refresh(config)
    if payload.value is not None and config.update_route:
        asyncio.create_task(_forward_to_device(config, payload.value))
    return ConfigResponse.model_validate(config)


async def _forward_to_device(config: Config, value: str):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if config.method == "POST":
                await client.post(config.update_route, json={"value": value})
            elif config.method == "PUT":
                await client.put(config.update_route, params={"value": value})
            else:
                await client.get(config.update_route, params={"value": value})
    except Exception:
        pass


@app.get("/api/configs/{config_id}/sync", response_model=ConfigResponse)
async def sync_config(
    config_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    config = await db.get(Config, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    controller = await db.get(Controller, config.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Config not found")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(config.read_route)
            raw = resp.text.strip()
            config.value = raw
            await db.commit()
            await db.refresh(config)
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to read from device")
    return ConfigResponse.model_validate(config)


@app.delete("/api/configs/{config_id}")
async def delete_config(
    config_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    config = await db.get(Config, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    controller = await db.get(Controller, config.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Config not found")
    await db.delete(config)
    await db.commit()
    return {"message": "Config deleted"}


# ═══════════════════════════════════════════════
#  Thresholds
# ═══════════════════════════════════════════════

@app.get("/api/thresholds", response_model=list[ThresholdResponse])
async def list_thresholds(
    device_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await verify_device_owner(device_id, user, db)
    result = await db.execute(select(Threshold).where(Threshold.device_id == device_id))
    return [ThresholdResponse.model_validate(t) for t in result.scalars().all()]


@app.post("/api/thresholds", response_model=ThresholdResponse)
async def create_threshold(
    payload: ThresholdCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await verify_device_owner(payload.device_id, user, db)
    threshold = Threshold(
        device_id=payload.device_id,
        label=payload.label,
        min_threshold=payload.min_threshold,
        max_threshold=payload.max_threshold,
    )
    db.add(threshold)
    await db.commit()
    await db.refresh(threshold)
    return ThresholdResponse.model_validate(threshold)


@app.put("/api/thresholds/{threshold_id}", response_model=ThresholdResponse)
async def update_threshold(
    threshold_id: int,
    payload: ThresholdUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    threshold = await db.get(Threshold, threshold_id)
    if not threshold:
        raise HTTPException(status_code=404, detail="Threshold not found")
    device = await db.get(Device, threshold.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    controller = await db.get(Controller, device.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Threshold not found")
    update_data = payload.model_dump(exclude_unset=True)
    if "label" in update_data:
        threshold.label = update_data["label"]
    if "min_threshold" in update_data:
        threshold.min_threshold = update_data["min_threshold"]
    if "max_threshold" in update_data:
        threshold.max_threshold = update_data["max_threshold"]
    await db.commit()
    await db.refresh(threshold)
    return ThresholdResponse.model_validate(threshold)


@app.delete("/api/thresholds/{threshold_id}")
async def delete_threshold(
    threshold_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    threshold = await db.get(Threshold, threshold_id)
    if not threshold:
        raise HTTPException(status_code=404, detail="Threshold not found")
    device = await db.get(Device, threshold.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    controller = await db.get(Controller, device.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Threshold not found")
    await db.delete(threshold)
    await db.commit()
    return {"message": "Threshold deleted"}


@app.post("/api/thresholds/sync", response_model=list[ThresholdResponse])
async def sync_thresholds(
    device_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await verify_device_owner(device_id, user, db)
    if not device.threshold_read_route:
        raise HTTPException(status_code=400, detail="Device has no threshold read route configured")
    raw = ""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(device.threshold_read_route)
            raw = resp.text
            if not raw.strip():
                raise ValueError(f"Empty response (status {resp.status_code})")
            entries = json.loads(raw)
    except Exception as e:
        snippet = repr(raw)[:200] if raw else "(no response)"
        detail = f"{e}\nURL: {device.threshold_read_route}\nRaw: {snippet}"
        raise HTTPException(status_code=502, detail=detail)
    old = await db.execute(select(Threshold).where(Threshold.device_id == device_id))
    for t in old.scalars().all():
        await db.delete(t)
    for entry in entries:
        t = Threshold(
            device_id=device_id,
            label=entry.get("label", ""),
            min_threshold=entry.get("min"),
            max_threshold=entry.get("max"),
        )
        db.add(t)
    await db.commit()
    result = await db.execute(select(Threshold).where(Threshold.device_id == device_id))
    return [ThresholdResponse.model_validate(t) for t in result.scalars().all()]


@app.post("/api/thresholds/push")
async def push_thresholds(
    device_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await verify_device_owner(device_id, user, db)
    if not device.threshold_update_route:
        raise HTTPException(status_code=400, detail="Device has no threshold update route configured")
    result = await db.execute(select(Threshold).where(Threshold.device_id == device_id))
    thresholds = result.scalars().all()
    parts = []
    for t in thresholds:
        label = t.label
        min_str = str(t.min_threshold) if t.min_threshold is not None else ""
        max_str = str(t.max_threshold) if t.max_threshold is not None else ""
        parts.append(f"{label},{min_str},{max_str}")
    compact = ";".join(parts)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if device.threshold_method == "PUT":
                await client.put(device.threshold_update_route, data={"value": compact})
            elif device.threshold_method == "POST":
                await client.post(device.threshold_update_route, data={"value": compact})
            else:
                await client.get(device.threshold_update_route, params={"value": compact})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to push thresholds: {str(e)}")
    return {"message": "Thresholds pushed to device"}


@app.post("/api/mqtt/subscribe/{controller_id}")
async def mqtt_subscribe(
    controller_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = await db.get(Controller, controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Controller not found")
    await mqtt_service.subscribe_controller(controller_id)
    return {"message": f"Subscribed to controller {controller_id}"}


@app.post("/api/mqtt/unsubscribe/{controller_id}")
async def mqtt_unsubscribe(
    controller_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    controller = await db.get(Controller, controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Controller not found")
    await mqtt_service.unsubscribe_controller(controller_id)
    return {"message": f"Unsubscribed from controller {controller_id}"}


@app.get("/api/mqtt/status")
async def mqtt_status():
    return {"connected": mqtt_service.connected}


@app.get("/api/mqtt/retained/{device_id}")
async def mqtt_read_retained(
    device_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await verify_device_owner(device_id, user, db)
    controller = await db.get(Controller, device.controller_id)
    topic = f"{controller.mqtt_topic}/{device.name}"
    value = mqtt_service.get_cached(topic)
    return {"device_id": device_id, "value": value}


@app.post("/api/mqtt/publish")
async def mqtt_publish(
    payload: MQTTPublish,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await db.get(Device, payload.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    controller = await db.get(Controller, device.controller_id)
    if not controller or controller.user_id != user.id:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.device_type != "actuator":
        raise HTTPException(status_code=400, detail="Device is not an actuator")
    topic = f"{controller.mqtt_topic}/{device.name}"
    print(f"[MQTT Publish] topic={topic} value={payload.value} connected={mqtt_service.connected}")
    mqtt_service.publish(topic, payload.value)
    return {"message": "Published", "topic": topic, "value": payload.value}


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    mqtt_service.add_websocket(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        mqtt_service.remove_websocket(websocket)


@app.post("/api/ai/insight", response_model=AIInsightResponse)
async def ai_insight(
    payload: AIInsightRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not payload.device_context:
        result = await db.execute(
            select(Device).join(Controller).where(Controller.user_id == user.id)
        )
        devices = result.scalars().all()
        context = []
        for d in devices:
            data_result = await db.execute(
                select(DeviceData)
                .where(DeviceData.device_id == d.id)
                .order_by(DeviceData.timestamp.desc())
                .limit(30)
            )
            readings = data_result.scalars().all()
            context.append({
                "name": d.name,
                "device_type": d.device_type,
                "unit": d.unit,
                "readings": [
                    f"{r.value} ({r.value_str})" if r.value is not None and r.value_str
                    else (r.value if r.value is not None else (r.value_str or "No data"))
                    for r in readings
                ],
            })
    else:
        context = payload.device_context

    result = await ai_service.get_insight(payload.prompt, context)
    return AIInsightResponse(
        status=result.get("status", "Caution"),
        recommendations=result.get("recommendations", ["Unable to generate recommendations at this time."]),
        answer=result.get("answer"),
        model=ai_service.model,
    )


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
