"""Test fixtures.

The suite runs with the real application wiring: real routers, real services,
real Stripe *signature verification*. Only the outbound provider HTTP calls
and the SMTP transport are faked, because those are the parts that require a
network and credentials.

Two backends are supported:

* **SQLite (default)** — no server needed, so the suite runs anywhere.
* **PostgreSQL** — set ``TEST_DATABASE_URL`` to run against the real target
  database. This is the only way to exercise ``SELECT ... FOR UPDATE`` and
  ``SKIP LOCKED``, so the concurrency tests are skipped without it.

      TEST_DATABASE_URL=postgresql+asyncpg://meduza:meduza@127.0.0.1/meduza_test pytest
"""

from __future__ import annotations

import os
import time

import pytest

os.environ.update(
    ENVIRONMENT="test",
    PAYMENT_PROVIDER="fake",
    EMAIL_BACKEND="memory",
    DATABASE_URL=os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:"),
    STRIPE_WEBHOOK_SECRET="whsec_test_secret",
    ADMIN_API_KEY="test-admin-key-0123456789abcdefghijklmn",
    PUBLIC_BASE_URL="http://testserver",
    RATE_LIMIT_ENABLED="false",
    LOG_FORMAT="console",
    LOG_LEVEL="WARNING",
    CURRENCY="usd",
    SHIPPING_FLAT_MINOR="500",
    REDIS_URL="",
)

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool, StaticPool

from app import db as db_module
from app.config import get_settings, reset_settings_cache
from app.main import create_app
from app.models import Base, Product
from app.notifications.console import MemoryChannel
from app.payments.fake import FakeGateway
from app.ratelimit import MemoryBackend, RateLimiter

ADMIN_KEY = os.environ["ADMIN_API_KEY"]
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
USING_POSTGRES = TEST_DATABASE_URL.startswith("postgresql")

#: Concurrency behaviour depends on real row locks, which SQLite does not have.
requires_postgres = pytest.mark.skipif(
    not USING_POSTGRES,
    reason="needs a real PostgreSQL server; set TEST_DATABASE_URL",
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def engine():
    """A clean database per test, on whichever backend is configured."""
    reset_settings_cache()
    if USING_POSTGRES:
        engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    else:
        # One shared in-memory database for the whole test, across all sessions.
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    db_module.set_engine(engine, maker)
    yield engine
    await engine.dispose()
    db_module._engine = None
    db_module._sessionmaker = None


@pytest.fixture
def settings(engine):
    return get_settings()


@pytest.fixture
def gateway() -> FakeGateway:
    return FakeGateway("whsec_test_secret")


@pytest.fixture
def channel() -> MemoryChannel:
    return MemoryChannel()


@pytest.fixture
async def app(engine, gateway, channel, settings):
    application = create_app()
    # Bypass lifespan so the fixture-provided engine/gateway/channel are used.
    application.state.settings = settings
    application.state.gateway = gateway
    application.state.channel = channel
    application.state.limiter = RateLimiter(MemoryBackend(), enabled=False)
    return application


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def admin_headers() -> dict[str, str]:
    return {"X-Admin-Api-Key": ADMIN_KEY}


@pytest.fixture
async def products(engine):
    """Two lawful catalog items with known prices and stock."""
    from app.db import session_scope

    specs = [
        {
            "sku": "COF-ETH-250",
            "slug": "ethiopia-yirgacheffe-250g",
            "name": "Ethiopia Yirgacheffe, 250g",
            "description": "Washed single-origin filter roast.",
            "unit_price_minor": 1650,
            "stock_on_hand": 10,
        },
        {
            "sku": "EQP-SCL-01",
            "slug": "brew-scale-0-1g",
            "name": "Brew Scale (0.1g)",
            "description": "Rechargeable 2kg scale.",
            "unit_price_minor": 5400,
            "stock_on_hand": 3,
        },
    ]
    created = []
    async with session_scope() as session:
        for spec in specs:
            product = Product(
                **spec, currency="usd", is_active=True, requires_shipping=True
            )
            session.add(product)
            created.append(product)
        await session.flush()
    return {p.sku: p for p in created}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
VALID_ADDRESS = {
    "line1": "12 Example Street",
    "city": "Springfield",
    "postal_code": "12345",
    "country": "US",
}


def checkout_payload(**overrides) -> dict:
    payload = {
        "email": "buyer@example.com",
        "customer_name": "Sam Buyer",
        "items": [{"sku": "COF-ETH-250", "quantity": 2}],
        "shipping_address": dict(VALID_ADDRESS),
    }
    payload.update(overrides)
    return payload


def stripe_event(event_type: str, obj: dict, event_id: str | None = None) -> dict:
    """Build an event envelope shaped like the provider's."""
    return {
        "id": event_id or f"evt_test_{int(time.time() * 1000)}",
        "object": "event",
        "api_version": "2024-06-20",
        "created": int(time.time()),
        "type": event_type,
        "livemode": False,
        "data": {"object": obj},
    }


def completed_session(order, session_id: str, payment_intent: str) -> dict:
    return {
        "id": session_id,
        "object": "checkout.session",
        "amount_total": order["total_minor"],
        "currency": order["currency"],
        "client_reference_id": order["order_id"],
        "customer_email": "buyer@example.com",
        "metadata": {"order_id": order["order_id"], "order_reference": order["reference"]},
        "payment_intent": payment_intent,
        "payment_status": "paid",
        "status": "complete",
    }
