from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
import os
from dotenv import load_dotenv
import urllib.parse

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

DB_HOST = os.getenv("DB_HOST")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")

encoded_password = urllib.parse.quote(DB_PASSWORD, safe="")

DATABASE_URL = f"mysql+aiomysql://{DB_USER}:{encoded_password}@{DB_HOST}/{DB_NAME}?charset=utf8mb4"

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=0,
    pool_recycle=60,
    pool_pre_ping=True,
    connect_args={
        "connect_timeout": 10,
    },
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import inspect

        def add_missing_columns(sync_conn):
            inspector = inspect(sync_conn)

            # controllers.image
            cols = [c["name"] for c in inspector.get_columns("controllers")]
            if "image" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE controllers ADD COLUMN image VARCHAR(500) NULL"
                )

            # device_data.value_str
            cols = [c["name"] for c in inspector.get_columns("device_data")]
            if "value_str" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE device_data ADD COLUMN value_str TEXT NULL"
                )
            if "value" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE device_data ADD COLUMN value DOUBLE NULL"
                )

            # configs.name
            cols = [c["name"] for c in inspector.get_columns("configs")]
            if "name" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE configs ADD COLUMN name VARCHAR(100) NOT NULL DEFAULT ''"
                )

            # devices threshold_* columns
            cols = [c["name"] for c in inspector.get_columns("devices")]
            if "threshold_read_route" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE devices ADD COLUMN threshold_read_route VARCHAR(255) NULL"
                )
            if "threshold_update_route" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE devices ADD COLUMN threshold_update_route VARCHAR(255) NULL"
                )
            if "threshold_method" not in cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE devices ADD COLUMN threshold_method VARCHAR(10) NOT NULL DEFAULT 'GET'"
                )

        await conn.run_sync(add_missing_columns)
