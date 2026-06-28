from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
import uuid


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    registration_date = Column(DateTime, server_default=func.now(), nullable=False)
    last_login_date = Column(DateTime, nullable=True)

    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    controllers = relationship("Controller", back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    expires_at = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="sessions")


class Controller(Base):
    __tablename__ = "controllers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(100), nullable=False)
    mqtt_topic = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    image = Column(String(500), nullable=True)
    registered_at = Column(DateTime, server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="controllers")
    devices = relationship("Device", back_populates="controller", cascade="all, delete-orphan")
    configs = relationship("Config", back_populates="controller", cascade="all, delete-orphan")


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    controller_id = Column(Integer, ForeignKey("controllers.id"), nullable=False)
    name = Column(String(100), nullable=False)
    device_type = Column(String(50), nullable=False)
    unit = Column(String(20), nullable=True)
    threshold_read_route = Column(String(255), nullable=True)
    threshold_update_route = Column(String(255), nullable=True)
    threshold_method = Column(String(10), nullable=False, default="GET")

    controller = relationship("Controller", back_populates="devices")
    data = relationship("DeviceData", back_populates="device", cascade="all, delete-orphan")
    thresholds = relationship("Threshold", back_populates="device", cascade="all, delete-orphan")


class DeviceData(Base):
    __tablename__ = "device_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    value = Column(Float, nullable=True)
    value_str = Column(Text, nullable=True)
    timestamp = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    device = relationship("Device", back_populates="data")


class Config(Base):
    __tablename__ = "configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    controller_id = Column(Integer, ForeignKey("controllers.id"), nullable=False)
    name = Column(String(100), nullable=False, default="")
    read_route = Column(String(255), nullable=False)
    update_route = Column(String(255), nullable=False)
    method = Column(String(10), nullable=False, default="GET")
    possible_values = Column(JSON, nullable=True)
    value = Column(String(255), nullable=False)

    controller = relationship("Controller", back_populates="configs")


class Threshold(Base):
    __tablename__ = "thresholds"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    label = Column(String(100), nullable=False)
    min_threshold = Column(Float, nullable=True)
    max_threshold = Column(Float, nullable=True)

    device = relationship("Device", back_populates="thresholds")
