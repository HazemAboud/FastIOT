import asyncio
import json
from datetime import datetime, timezone
from typing import Set, Dict, Optional

import paho.mqtt.client as mqtt

from sqlalchemy import select

from .database import async_session
from .models import Device, DeviceData, Controller


class MQTTService:
    def __init__(self):
        self.client = None
        self.connected = False
        self.loop = None
        self.message_queue: asyncio.Queue = None
        self._consumer_task = None
        self.websockets: Set = set()
        self._subscribed_controllers: Set[int] = set()
        self._topic_cache: Dict[str, str] = {}

    def start(self, host: str = "localhost", port: int = 1883, username: str = None, password: str = None):
        self.loop = asyncio.get_event_loop()
        self.message_queue = asyncio.Queue()

        self.client = mqtt.Client()
        if username and password:
            self.client.username_pw_set(username, password)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.connect_async(host, port)
        self.client.loop_start()

        self._consumer_task = asyncio.create_task(self._consume_messages())

    def stop(self):
        if self._consumer_task:
            self._consumer_task.cancel()
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()

    def _on_connect(self, client, userdata, flags, rc):
        self.connected = rc == 0

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = msg.payload.decode(errors='replace')
        self._topic_cache[topic] = payload
        self.loop.call_soon_threadsafe(
            self.message_queue.put_nowait, (topic, msg.payload)
        )

    async def _consume_messages(self):
        while True:
            topic, payload = await self.message_queue.get()
            asyncio.create_task(self._handle_message(topic, payload))

    async def _handle_message(self, topic: str, payload: bytes):
        async with async_session() as db:
            for ctrl_id in list(self._subscribed_controllers):
                ctrl = await db.get(Controller, ctrl_id)
                if not ctrl:
                    continue
                prefix = ctrl.mqtt_topic + "/"
                if not topic.startswith(prefix):
                    continue
                device_name = topic[len(prefix):]
                if "/" in device_name:
                    continue
                result = await db.execute(
                    select(Device).where(
                        Device.controller_id == ctrl_id,
                        Device.name == device_name,
                    )
                )
                device = result.scalar_one_or_none()
                if device:
                    raw = payload.decode(errors='replace')
                    num_value, str_value = self._parse_value(payload, raw)
                    timestamp = datetime.now(timezone.utc).isoformat()

                    record = DeviceData(
                        device_id=device.id,
                        value=num_value,
                        value_str=str_value,
                    )
                    db.add(record)
                    await db.commit()
                    await db.refresh(record)
                    timestamp = record.timestamp.isoformat() if record.timestamp else timestamp

                    display_value = str_value if str_value is not None else num_value
                    msg_data = {
                        "type": "device_data",
                        "device_id": device.id,
                        "device_name": device.name,
                        "device_type": device.device_type,
                        "value": display_value,
                        "timestamp": timestamp,
                    }
                    for ws in self.websockets.copy():
                        try:
                            await ws.send_json(msg_data)
                        except Exception:
                            self.websockets.discard(ws)
                    return

    def _parse_value(self, payload: bytes, raw: str = ""):
        if not raw:
            raw = payload.decode(errors='replace')
        try:
            return float(raw), None
        except (ValueError, UnicodeDecodeError):
            pass
        try:
            data = json.loads(payload)
            if "value" in data:
                v = data["value"]
                try:
                    return float(v), None
                except (ValueError, TypeError):
                    return None, str(v)
            for v in data.values():
                if isinstance(v, (int, float)):
                    return float(v), None
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
        return None, raw

    async def subscribe_controller(self, controller_id: int):
        if controller_id in self._subscribed_controllers:
            return
        self._subscribed_controllers.add(controller_id)

        async with async_session() as db:
            ctrl = await db.get(Controller, controller_id)
            if ctrl and self.client and self.connected:
                topic = f"{ctrl.mqtt_topic}/#"
                self.client.subscribe(topic)

    async def unsubscribe_controller(self, controller_id: int):
        if controller_id not in self._subscribed_controllers:
            return
        self._subscribed_controllers.discard(controller_id)

        async with async_session() as db:
            ctrl = await db.get(Controller, controller_id)
            if ctrl and self.client and self.connected:
                topic = f"{ctrl.mqtt_topic}/#"
                self.client.unsubscribe(topic)

    def get_cached(self, topic: str) -> Optional[str]:
        return self._topic_cache.get(topic)

    def publish(self, topic: str, payload: str):
        if self.client and self.connected:
            self._topic_cache[topic] = payload
            self.client.publish(topic, payload)

    def add_websocket(self, ws):
        self.websockets.add(ws)

    def remove_websocket(self, ws):
        self.websockets.discard(ws)


mqtt_service = MQTTService()
