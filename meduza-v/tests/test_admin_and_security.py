"""Admin authentication, auditing, inventory control, rate limiting, health."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db import session_scope
from app.models import AdminAuditLog
from app.ratelimit import MemoryBackend, RateLimiter
from tests.conftest import ADMIN_KEY, checkout_payload

pytestmark = pytest.mark.anyio

ADMIN_ROUTES = [
    ("get", "/admin/orders", None),
    ("get", "/admin/outbox", None),
    ("post", "/admin/refunds", {"order_id": "x"}),
    ("post", "/admin/products", {}),
]


@pytest.mark.parametrize("method, path, body", ADMIN_ROUTES)
async def test_admin_routes_reject_anonymous_callers(client, products, method, path, body):
    response = await getattr(client, method)(path, **({"json": body} if body else {}))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.parametrize(
    "headers",
    [
        {"X-Admin-Api-Key": "wrong-key"},
        {"X-Admin-Api-Key": ADMIN_KEY[:-1]},        # near miss
        {"X-Admin-Api-Key": ADMIN_KEY + "x"},       # prefix of the real key
        {"Authorization": "Bearer wrong-key"},
        {"Authorization": "Basic " + ADMIN_KEY},    # wrong scheme
    ],
)
async def test_bad_admin_credentials_are_rejected(client, products, headers):
    response = await client.get("/admin/orders", headers=headers)
    assert response.status_code == 401


async def test_bearer_token_is_accepted(client, products):
    response = await client.get(
        "/admin/orders", headers={"Authorization": f"Bearer {ADMIN_KEY}"}
    )
    assert response.status_code == 200


async def test_admin_can_list_and_inspect_orders(client, products, admin_headers):
    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()

    listing = await client.get("/admin/orders", headers=admin_headers)
    assert listing.status_code == 200
    assert listing.json()["total"] == 1

    detail = await client.get(f"/admin/orders/{created['order_id']}", headers=admin_headers)
    assert detail.status_code == 200
    assert detail.json()["reference"] == created["reference"]
    assert len(detail.json()["items"]) == 1


async def test_admin_actions_are_audited(client, products, admin_headers):
    product_id = products["COF-ETH-250"].id
    response = await client.post(
        f"/admin/products/{product_id}/stock",
        json={"delta": 25, "reason": "goods received PO-1001"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["stock_available"] == 35

    async with session_scope() as db:
        entry = await db.scalar(select(AdminAuditLog))
        assert entry.action == "product.stock_adjust"
        assert entry.subject_id == product_id
        assert entry.detail["delta"] == 25
        assert entry.request_id


async def test_stock_cannot_be_driven_below_what_is_reserved(
    client, products, admin_headers
):
    await client.post("/api/checkout/sessions", json=checkout_payload())  # reserves 2
    response = await client.post(
        f"/admin/products/{products['COF-ETH-250'].id}/stock",
        json={"delta": -9, "reason": "shrinkage"},
        headers=admin_headers,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "out_of_stock"


async def test_duplicate_sku_is_rejected(client, products, admin_headers):
    payload = {
        "sku": "COF-ETH-250",
        "slug": "another-slug",
        "name": "Duplicate",
        "unit_price_minor": 100,
        "currency": "usd",
    }
    response = await client.post("/admin/products", json=payload, headers=admin_headers)
    assert response.status_code == 409


async def test_fulfilment_requires_a_paid_order(client, products, admin_headers):
    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()
    response = await client.post(
        f"/admin/orders/{created['order_id']}/fulfillment",
        json={"status": "shipped", "carrier": "ExamplePost", "tracking_number": "TRK1"},
        headers=admin_headers,
    )
    assert response.status_code == 409


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #
async def test_rate_limiter_allows_then_blocks():
    limiter = RateLimiter(MemoryBackend(), enabled=True)
    for _ in range(3):
        allowed, _ = await limiter.check("ip:1.2.3.4", limit=3)
        assert allowed
    allowed, retry_after = await limiter.check("ip:1.2.3.4", limit=3)
    assert not allowed and retry_after >= 1


async def test_rate_limiter_is_keyed_per_client():
    limiter = RateLimiter(MemoryBackend(), enabled=True)
    await limiter.check("ip:1.1.1.1", limit=1)
    blocked, _ = await limiter.check("ip:1.1.1.1", limit=1)
    allowed, _ = await limiter.check("ip:2.2.2.2", limit=1)
    assert not blocked and allowed


async def test_rate_limiter_fails_open_when_the_backend_breaks():
    class BrokenBackend:
        async def incr(self, key, window_seconds):
            raise RuntimeError("redis down")

        async def close(self):
            pass

    limiter = RateLimiter(BrokenBackend(), enabled=True)
    allowed, _ = await limiter.check("ip:1.2.3.4", limit=1)
    assert allowed, "a limiter outage must not take checkout down"


async def test_checkout_is_rate_limited(app, client, products, monkeypatch):
    """The third request in one window is refused.

    The clock is pinned because the limiter uses a fixed window keyed on
    ``int(time.time() // 60)``. Four unpinned requests that happen to straddle
    a minute boundary land in two buckets, neither of which reaches the limit,
    and every one of them returns 201 — which is correct behaviour for a
    fixed-window limiter and a false failure for this test. It cost a red CI
    run before it was pinned.
    """
    app.state.limiter = RateLimiter(MemoryBackend(), enabled=True)
    app.state.settings.rate_limit_checkout_per_minute = 2

    class _PinnedClock:
        @staticmethod
        def time() -> float:
            return 1_000_000.0  # mid-window: 1_000_000 % 60 == 40

    monkeypatch.setattr("app.ratelimit.time", _PinnedClock)

    statuses = []
    for i in range(4):
        response = await client.post(
            "/api/checkout/sessions",
            json=checkout_payload(items=[{"sku": "COF-ETH-250", "quantity": 1}]),
            headers={"Idempotency-Key": f"key-{i}"},
        )
        statuses.append(response.status_code)
    assert statuses == [201, 201, 429, 429], statuses


async def test_forwarded_for_is_not_trusted_by_default(client, products):
    from app.config import get_settings
    from app.security import client_ip

    class FakeRequest:
        headers = {"x-forwarded-for": "9.9.9.9"}
        client = type("C", (), {"host": "10.0.0.1"})()

    assert client_ip(FakeRequest(), get_settings()) == "10.0.0.1"


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
async def test_liveness_never_touches_the_database(client):
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_readiness_reports_dependencies(client, products):
    response = await client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["checks"]["database"] == "ok"


async def test_metrics_expose_order_and_outbox_counts(client, products):
    await client.post("/api/checkout/sessions", json=checkout_payload())
    response = await client.get("/metrics")
    assert response.status_code == 200
    assert 'meduza_orders_total{status="pending_payment"} 1' in response.text
    assert "meduza_outbox_messages_total" in response.text
    assert "meduza_uptime_seconds" in response.text


async def test_error_responses_do_not_leak_internals(client, products, admin_headers):
    response = await client.get("/admin/orders/does-not-exist", headers=admin_headers)
    assert response.status_code == 404
    assert "Traceback" not in response.text
    assert set(response.json()["error"]) == {"code", "message", "details"}


async def test_no_secret_appears_in_any_response(client, products, admin_headers):
    for path in ("/readyz", "/metrics", "/api/catalog/products"):
        body = (await client.get(path)).text
        assert ADMIN_KEY not in body
        assert "whsec_" not in body
