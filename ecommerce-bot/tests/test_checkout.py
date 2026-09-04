"""Checkout: pricing, reservation, idempotency, and provider failure."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db import session_scope
from app.errors import PaymentProviderError
from app.models import InventoryState, Order, OrderStatus, Product
from tests.conftest import checkout_payload

pytestmark = pytest.mark.anyio


async def test_checkout_prices_server_side_and_reserves_stock(client, products, gateway):
    response = await client.post("/api/checkout/sessions", json=checkout_payload())
    assert response.status_code == 201, response.text
    body = response.json()

    # 2 x 1650 + 500 flat shipping. The client never sent a price.
    assert body["total_minor"] == 2 * 1650 + 500
    assert body["currency"] == "usd"
    assert body["status"] == "pending_payment"
    assert body["checkout_url"].startswith("https://checkout.example.test/pay/")
    assert body["order_status_url"].startswith("http://testserver/api/orders/")

    async with session_scope() as db:
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 2
        assert product.stock_on_hand == 10  # not yet sold
        order = await db.get(Order, body["order_id"])
        assert order.inventory_state is InventoryState.reserved
        assert order.provider_session_id in gateway.sessions


async def test_client_supplied_prices_are_ignored(client, products):
    """A tampered payload cannot change what the buyer is charged."""
    payload = checkout_payload()
    payload["items"][0]["unit_price_minor"] = 1  # not part of the schema
    response = await client.post("/api/checkout/sessions", json=payload)
    # extra="forbid" rejects it outright rather than silently ignoring it.
    assert response.status_code == 422


async def test_idempotency_key_returns_the_same_order(client, products):
    headers = {"Idempotency-Key": "buy-button-click-1"}
    first = await client.post("/api/checkout/sessions", json=checkout_payload(), headers=headers)
    second = await client.post("/api/checkout/sessions", json=checkout_payload(), headers=headers)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["order_id"] == second.json()["order_id"]

    async with session_scope() as db:
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 2  # reserved once, not twice


async def test_double_submit_without_a_key_still_deduplicates(client, products):
    """The request digest is the fallback idempotency key."""
    first = await client.post("/api/checkout/sessions", json=checkout_payload())
    second = await client.post("/api/checkout/sessions", json=checkout_payload())
    assert first.json()["order_id"] == second.json()["order_id"]


async def test_out_of_stock_is_rejected(client, products):
    response = await client.post(
        "/api/checkout/sessions",
        json=checkout_payload(items=[{"sku": "EQP-SCL-01", "quantity": 5}]),
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "out_of_stock"
    assert response.json()["error"]["details"]["available"] == 3


async def test_provider_failure_releases_the_reservation(client, products, gateway):
    gateway.fail_next = PaymentProviderError("The payment provider is unavailable.")
    response = await client.post("/api/checkout/sessions", json=checkout_payload())
    assert response.status_code == 502

    async with session_scope() as db:
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 0, "stock must not leak on provider failure"
        order = await db.scalar(select(Order))
        assert order.status is OrderStatus.cancelled
        assert order.inventory_state is InventoryState.released


async def test_order_status_requires_the_access_token(client, products):
    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()
    order_id = created["order_id"]

    missing = await client.get(f"/api/orders/{order_id}")
    assert missing.status_code == 422

    wrong = await client.get(f"/api/orders/{order_id}", params={"token": "x" * 32})
    assert wrong.status_code == 404, "a wrong token must be indistinguishable from a miss"

    token = created["order_status_url"].split("token=")[1]
    ok = await client.get(f"/api/orders/{order_id}", params={"token": token})
    assert ok.status_code == 200
    assert ok.json()["reference"] == created["reference"]


async def test_no_card_data_is_ever_persisted(client, products, engine):
    """Structural guarantee: the schema has nowhere to put a PAN."""
    await client.post("/api/checkout/sessions", json=checkout_payload())
    columns = {
        f"{table.name}.{column.name}".lower()
        for table in Order.metadata.sorted_tables
        for column in table.columns
    }
    forbidden = ("card_number", "pan", "cvc", "cvv", "expiry", "card_last4")
    assert not [c for c in columns if any(f in c for f in forbidden)]
