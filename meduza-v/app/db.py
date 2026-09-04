"""Async SQLAlchemy engine/session management.

The app targets PostgreSQL in production. SQLite (aiosqlite) is supported for
the test suite, so a few places branch on dialect (row locking, JSON type).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import Settings, get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _engine_kwargs(settings: Settings) -> dict:
    if settings.database_url.startswith("sqlite"):
        # SQLite has no server-side pool semantics worth configuring.
        return {"echo": settings.db_echo}
    return {
        "echo": settings.db_echo,
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
        "pool_pre_ping": True,
        "pool_recycle": 1800,
    }


def init_engine(settings: Settings | None = None) -> AsyncEngine:
    global _engine, _sessionmaker
    settings = settings or get_settings()
    if _engine is None:
        _engine = create_async_engine(settings.database_url, **_engine_kwargs(settings))
        _sessionmaker = async_sessionmaker(
            _engine, expire_on_commit=False, autoflush=False
        )
    return _engine


def get_engine() -> AsyncEngine:
    return init_engine()


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    init_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


def set_engine(engine: AsyncEngine, maker: async_sessionmaker[AsyncSession]) -> None:
    """Injection hook for tests."""
    global _engine, _sessionmaker
    _engine, _sessionmaker = engine, maker


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Transactional scope: commits on success, rolls back on any exception."""
    maker = get_sessionmaker()
    async with maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency."""
    async with session_scope() as session:
        yield session


def supports_row_locking(session: AsyncSession) -> bool:
    return session.bind.dialect.name not in {"sqlite"}
