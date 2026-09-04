"""Inventory concurrency, application boot, and the Redis rate-limit backend.

The concurrency tests need real row locks, so they run only against
PostgreSQL (``TEST_DATABASE_URL``). On SQLite they are skipped rather than
silently passing for the wrong reason.
"""

from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import func, select

from app.db import session_scope
from app.models import InventoryState, Order, OrderStatus, OutboxMessage, Product
from tests.conftest import (
    VALID_ADDRESS,
    checkout_payload,
    completed_session,
    requires_postgres,
    stripe_event,
)

pytestmark = pytest.mark.anyio


# --------------------------------------------------------------------------- #
# Inventory concurrency
# --------------------------------------------------------------------------- #
@requires_postgres
async def test_concurrent_checkouts_cannot_oversell(client, products):
    """Ten buyers race for three units. Exactly three may win.

    This is the test that row locking exists for: without
    ``SELECT ... FOR UPDATE`` in the reservation path, several transactions
    read the same availability and all decide there is stock.
    """
    async def buy(n: int):
        return await client.post(
            "/api/checkout/sessions",
            json={
                "email": f"racer{n}@example.com",
                "items": [{"sku": "EQP-SCL-01", "quantity": 1}],  # stock_on_hand = 3
                "shipping_address": dict(VALID_ADDRESS),
            },
            headers={"Idempotency-Key": f"race-{n}"},
        )

    responses = await asyncio.gather(*(buy(i) for i in range(10)))
    codes = [r.status_code for r in responses]
    created = codes.count(201)
    rejected = codes.count(409)

    assert created == 3, f"expected exactly 3 winners, got {created} ({codes})"
    assert created + rejected == 10, f"unexpected status codes: {codes}"

    async with session_scope() as db:
        product = await db.scalar(select(Product).where(Product.sku == "EQP-SCL-01"))
        assert product.stock_reserved == 3
        assert product.stock_on_hand == 3
        assert product.stock_available == 0, "not one unit oversold"


@requires_postgres
async def test_concurrent_checkouts_with_one_key_create_one_order(client, products):
    """A double-clicked buy button under a race still yields a single order."""
    async def buy():
        return await client.post(
            "/api/checkout/sessions",
            json=checkout_payload(),
            headers={"Idempotency-Key": "double-click"},
        )

    responses = await asyncio.gather(*(buy() for _ in range(5)), return_exceptions=True)
    ok = [r for r in responses if not isinstance(r, Exception) and r.status_code == 201]
    order_ids = {r.json()["order_id"] for r in ok}
    assert len(order_ids) == 1, f"one basket must produce one order, got {order_ids}"

    async with session_scope() as db:
        assert await db.scalar(select(func.count()).select_from(Order)) == 1
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 2, "reserved once, not five times"


@requires_postgres
async def test_concurrent_duplicate_webhooks_apply_once(client, products, gateway):
    """The same event delivered five times at once still commits stock once."""
    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()
    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        ids = (order.provider_session_id, order.provider_payment_intent_id)

    body, signature = gateway.sign(
        stripe_event(
            "checkout.session.completed",
            completed_session(created, *ids),
            event_id="evt_concurrent",
        )
    )

    async def deliver():
        return await client.post(
            "/webhooks/stripe", content=body, headers={"Stripe-Signature": signature}
        )

    responses = await asyncio.gather(*(deliver() for _ in range(5)), return_exceptions=True)
    ok = [r for r in responses if not isinstance(r, Exception)]
    assert all(r.status_code == 200 for r in ok)
    assert sum(r.json().get("status") == "processed" for r in ok) == 1, (
        "exactly one delivery may claim the event"
    )

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.paid
        assert order.inventory_state is InventoryState.committed
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_on_hand == 8, "committed exactly once"
        assert product.stock_reserved == 0
        receipts = await db.scalar(
            select(func.count()).select_from(OutboxMessage).where(
                OutboxMessage.kind == "receipt.paid"
            )
        )
        assert receipts == 1


@requires_postgres
async def test_concurrent_workers_do_not_send_a_receipt_twice(
    client, products, gateway, channel, settings
):
    """Two workers draining the queue at once: SKIP LOCKED keeps them apart."""
    from app.worker import Worker

    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()
    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        ids = (order.provider_session_id, order.provider_payment_intent_id)
    body, signature = gateway.sign(
        stripe_event("checkout.session.completed", completed_session(created, *ids))
    )
    await client.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": signature})

    workers = [Worker(settings, channel, gateway) for _ in range(3)]
    results = await asyncio.gather(
        *(w.drain_outbox() for w in workers), return_exceptions=True
    )
    delivered = sum(r for r in results if isinstance(r, int))
    assert delivered == 1, f"one receipt, one delivery (got {results})"
    assert len(channel.sent) == 1


# --------------------------------------------------------------------------- #
# Application boot
# --------------------------------------------------------------------------- #
async def test_app_boots_through_the_real_lifespan(tmp_path):
    """Exercise create_app() plus the real lifespan: engine, gateway, channel,
    limiter, routes. This is the check that catches an import-time or wiring
    break that every fixture-injected test would miss."""
    import httpx

    from app import db as db_module
    from app.config import get_settings, reset_settings_cache
    from app.main import create_app
    from app.models import Base

    db_path = tmp_path / "boot.db"
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path}"
    db_module._engine = None
    db_module._sessionmaker = None
    reset_settings_cache()

    try:
        engine = db_module.init_engine(get_settings())
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        app = create_app()
        async with app.router.lifespan_context(app):
            assert app.state.gateway is not None
            assert app.state.channel is not None
            assert app.state.limiter is not None
            assert app.state.settings.environment == "test"

            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://boot") as c:
                assert (await c.get("/healthz")).json()["status"] == "ok"
                ready = await c.get("/readyz")
                assert ready.status_code == 200
                assert ready.json()["checks"]["database"] == "ok"
                assert (await c.get("/api/catalog/products")).status_code == 200
                assert (await c.get("/metrics")).status_code == 200
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
        db_module._engine = None
        db_module._sessionmaker = None
        reset_settings_cache()


async def test_every_expected_route_is_registered():
    """A router silently dropped from create_app() is a deploy-time outage.

    Read from the OpenAPI schema rather than walking ``app.routes``: FastAPI
    nests included routers behind wrapper objects, and the shape of that
    nesting has changed between versions.
    """
    from app.main import create_app

    schema = create_app().openapi()
    paths = {
        (path, method.upper())
        for path, operations in schema["paths"].items()
        for method in operations
    }
    required = [
        ("/healthz", "GET"),
        ("/readyz", "GET"),
        ("/metrics", "GET"),
        ("/api/catalog/products", "GET"),
        ("/api/catalog/products/{slug}", "GET"),
        ("/api/checkout/sessions", "POST"),
        ("/api/orders/{order_id}", "GET"),
        ("/webhooks/stripe", "POST"),
        ("/admin/orders", "GET"),
        ("/admin/orders/{order_id}", "GET"),
        ("/admin/orders/{order_id}/fulfillment", "POST"),
        ("/admin/refunds", "POST"),
        ("/admin/products", "POST"),
        ("/admin/products/{product_id}", "PATCH"),
        ("/admin/products/{product_id}/stock", "POST"),
        ("/admin/outbox", "GET"),
        ("/admin/outbox/{message_id}/retry", "POST"),
        ("/admin/webhooks", "GET"),
        ("/admin/webhooks/{event_id}/replay", "POST"),
    ]
    missing = [r for r in required if r not in paths]
    assert not missing, f"routes missing from the application: {missing}"


async def test_docs_are_disabled_in_production():
    """Interactive docs advertise the admin surface; production must not serve them."""
    from app.config import Settings
    from app.main import create_app

    prod = Settings(
        _env_file=None,
        environment="production",
        payment_provider="stripe",
        stripe_api_key="sk_live_example",
        stripe_webhook_secret="whsec_example",
        public_base_url="https://shop.example.com",
        email_backend="smtp",
        smtp_host="smtp.example.com",
        admin_api_key="a" * 40,
    )
    import app.main as main_module

    original = main_module.get_settings
    main_module.get_settings = lambda: prod
    try:
        application = create_app()
        assert application.docs_url is None
        assert application.openapi_url is None
    finally:
        main_module.get_settings = original


# --------------------------------------------------------------------------- #
# Redis rate-limit backend
# --------------------------------------------------------------------------- #
REDIS_TEST_URL = os.environ.get("REDIS_TEST_URL", "")
requires_redis = pytest.mark.skipif(
    not REDIS_TEST_URL, reason="needs a Redis server; set REDIS_TEST_URL"
)


@requires_redis
async def test_redis_backend_shares_counters_across_limiters():
    """Two limiters == two web replicas. They must share one budget."""
    import uuid

    from app.ratelimit import RateLimiter, RedisBackend

    key = f"test:{uuid.uuid4()}"
    a = RateLimiter(RedisBackend(REDIS_TEST_URL), enabled=True)
    b = RateLimiter(RedisBackend(REDIS_TEST_URL), enabled=True)
    try:
        assert (await a.check(key, limit=2))[0] is True
        assert (await b.check(key, limit=2))[0] is True
        # The third request is over budget regardless of which replica serves it.
        allowed, retry_after = await b.check(key, limit=2)
        assert allowed is False
        assert retry_after >= 1
    finally:
        await a.close()
        await b.close()


@requires_redis
async def test_build_limiter_selects_redis_when_configured():
    from app.ratelimit import RateLimiter, RedisBackend, build_limiter

    limiter = build_limiter(redis_url=REDIS_TEST_URL, enabled=True)
    try:
        assert isinstance(limiter, RateLimiter)
        assert isinstance(limiter._backend, RedisBackend)
    finally:
        await limiter.close()


async def test_build_limiter_falls_back_to_memory_on_a_bad_url():
    from app.ratelimit import MemoryBackend, build_limiter

    limiter = build_limiter(redis_url="not-a-valid-redis-url", enabled=True)
    try:
        assert isinstance(limiter._backend, MemoryBackend)
    finally:
        await limiter.close()
