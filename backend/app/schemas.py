from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    registration_date: datetime
    last_login_date: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    session_id: str
    user: UserResponse

    model_config = {"from_attributes": True}


class ControllerCreate(BaseModel):
    name: str
    mqtt_topic: str
    description: Optional[str] = None


class ControllerUpdate(BaseModel):
    name: Optional[str] = None
    mqtt_topic: Optional[str] = None
    description: Optional[str] = None


class ControllerResponse(BaseModel):
    id: int
    name: str
    mqtt_topic: str
    description: Optional[str] = None
    image: Optional[str] = None
    registered_at: datetime

    model_config = {"from_attributes": True}


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class DeviceCreate(BaseModel):
    controller_id: int
    name: str
    device_type: str
    unit: Optional[str] = None
    threshold_read_route: Optional[str] = None
    threshold_update_route: Optional[str] = None
    threshold_method: Optional[str] = "GET"


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    device_type: Optional[str] = None
    unit: Optional[str] = None
    threshold_read_route: Optional[str] = None
    threshold_update_route: Optional[str] = None
    threshold_method: Optional[str] = None

class DeviceResponse(BaseModel):
    id: int
    name: str
    device_type: str
    unit: Optional[str] = None
    controller_id: int
    threshold_read_route: Optional[str] = None
    threshold_update_route: Optional[str] = None
    threshold_method: str

    model_config = {"from_attributes": True}


class DeviceDataResponse(BaseModel):
    id: int
    value: Optional[float] = None
    value_str: Optional[str] = None
    timestamp: datetime

    model_config = {"from_attributes": True}


class DeviceHealthResponse(BaseModel):
    device_id: int
    device_name: str
    device_type: str
    unit: Optional[str] = None
    last_value: Optional[float] = None
    last_value_str: Optional[str] = None
    last_timestamp: Optional[datetime] = None
    status: str  # healthy | warning | critical | no_data


class MQTTPublish(BaseModel):
    device_id: int
    value: str


class ConfigCreate(BaseModel):
    controller_id: int
    name: str
    read_route: str
    update_route: str
    method: Optional[str] = "GET"
    value: Optional[str] = ""
    possible_values: Optional[list[str]] = None


class ConfigUpdate(BaseModel):
    name: Optional[str] = None
    read_route: Optional[str] = None
    update_route: Optional[str] = None
    method: Optional[str] = None
    value: Optional[str] = None
    possible_values: Optional[list[str]] = None


class ConfigResponse(BaseModel):
    id: int
    controller_id: int
    name: str
    read_route: str
    update_route: str
    method: str
    value: str
    possible_values: Optional[list[str]] = None

    model_config = {"from_attributes": True}


class ThresholdCreate(BaseModel):
    device_id: int
    label: str
    min_threshold: Optional[float] = None
    max_threshold: Optional[float] = None


class ThresholdUpdate(BaseModel):
    label: Optional[str] = None
    min_threshold: Optional[float] = None
    max_threshold: Optional[float] = None


class ThresholdResponse(BaseModel):
    id: int
    device_id: int
    label: str
    min_threshold: Optional[float] = None
    max_threshold: Optional[float] = None

    model_config = {"from_attributes": True}


class AIInsightRequest(BaseModel):
    prompt: str
    device_context: Optional[list[dict]] = None


class AIInsightResponse(BaseModel):
    status: str
    recommendations: list[str]
    answer: Optional[str] = None
    model: str



