import bcrypt
from datetime import datetime, timedelta, timezone
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User, Session


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def generate_session_id() -> str:
    return str(uuid.uuid4())


def get_session_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=7)


async def create_user(db: AsyncSession, username: str, email: str, password: str) -> User:
    user = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, username: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user and verify_password(password, user.password_hash):
        user.last_login_date = datetime.now(timezone.utc)
        await db.commit()
        return user
    return None


async def create_session(db: AsyncSession, user: User) -> Session:
    session = Session(
        session_id=generate_session_id(),
        user_id=user.id,
        expires_at=get_session_expiry(),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def get_session(db: AsyncSession, session_id: str) -> Session | None:
    result = await db.execute(
        select(Session).where(
            Session.session_id == session_id,
            Session.expires_at > datetime.now(timezone.utc),
        )
    )
    return result.scalar_one_or_none()


async def get_user_by_session(db: AsyncSession, session_id: str) -> User | None:
    session = await get_session(db, session_id)
    if session:
        result = await db.execute(select(User).where(User.id == session.user_id))
        return result.scalar_one_or_none()
    return None


async def delete_session(db: AsyncSession, session_id: str) -> None:
    result = await db.execute(select(Session).where(Session.session_id == session_id))
    session = result.scalar_one_or_none()
    if session:
        await db.delete(session)
        await db.commit()
