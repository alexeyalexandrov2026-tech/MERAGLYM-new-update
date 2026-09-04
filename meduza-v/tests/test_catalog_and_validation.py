"""Catalog browsing and input validation."""

from __future__ import annotations

import pytest

from tests.conftest import checkout_payload

pytestmark = pytest.mark.anyio


async def test_catalog_lists_active_products(client, products):
    response = await client.get("/api/catalog/products")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    skus = {item["sku"] for item in body["items"]}
    assert skus == {"COF-ETH-250", "EQP-SCL-01"}
    assert all("stock_available" in item for item in body["items"])


async def test_catalog_search_matches_name(client, products):
    response = await client.get("/api/catalog/products", params={"search": "scale"})
    assert response.status_code == 200
    assert [i["sku"] for i in response.json()["items"]] == ["EQP-SCL-01"]


async def test_product_detail_by_slug(client, products):
    response = await client.get("/api/catalog/products/ethiopia-yirgacheffe-250g")
    assert response.status_code == 200
    assert response.json()["unit_price_minor"] == 1650


async def test_unknown_slug_is_404(client, products):
    response = await client.get("/api/catalog/products/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize(
    "payload, reason",
    [
        (checkout_payload(email="not-an-email"), "malformed email"),
        (checkout_payload(items=[]), "empty basket"),
        (checkout_payload(items=[{"sku": "COF-ETH-250", "quantity": 0}]), "zero qty"),
        (checkout_payload(items=[{"sku": "COF-ETH-250", "quantity": -3}]), "negative qty"),
        (checkout_payload(items=[{"sku": "COF-ETH-250", "quantity": 9999}]), "over max qty"),
        (checkout_payload(items=[{"sku": "'; DROP TABLE orders;--", "quantity": 1}]), "sku pattern"),
        (
            checkout_payload(
                items=[
                    {"sku": "COF-ETH-250", "quantity": 1},
                    {"sku": "COF-ETH-250", "quantity": 2},
                ]
            ),
            "duplicate sku",
        ),
        (
            checkout_payload(shipping_address={"line1": "x", "city": "y", "postal_code": "1", "country": "USA"}),
            "bad country code",
        ),
        (checkout_payload(unexpected_field="x"), "extra field rejected"),
    ],
)
async def test_invalid_checkout_input_is_rejected(client, products, payload, reason):
    response = await client.post("/api/checkout/sessions", json=payload)
    assert response.status_code == 422, f"{reason}: {response.text}"
    assert response.json()["error"]["code"] == "validation_error"


async def test_unknown_sku_is_rejected_before_any_reservation(client, products, engine):
    from sqlalchemy import select

    from app.db import session_scope
    from app.models import Product

    response = await client.post(
        "/api/checkout/sessions",
        json=checkout_payload(items=[{"sku": "NOPE-1", "quantity": 1}]),
    )
    assert response.status_code == 422
    async with session_scope() as db:
        reserved = await db.scalar(select(Product.stock_reserved).where(Product.sku == "COF-ETH-250"))
    assert reserved == 0


async def test_shippable_order_requires_an_address(client, products):
    response = await client.post(
        "/api/checkout/sessions", json=checkout_payload(shipping_address=None)
    )
    assert response.status_code == 422


async def test_security_headers_are_present(client, products):
    response = await client.get("/api/catalog/products")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Request-ID"]


# --------------------------------------------------------------------------- #
# Unknown fields are rejected at every level of the request body, not just the
# top one. A nested model that silently ignores extras is how a tampered
# payload smuggles a price or a discount past validation.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "payload, where",
    [
        (checkout_payload(surprise="x"), "top level"),
        (
            checkout_payload(
                items=[{"sku": "COF-ETH-250", "quantity": 1, "unit_price_minor": 1}]
            ),
            "line item: injected price",
        ),
        (
            checkout_payload(
                items=[{"sku": "COF-ETH-250", "quantity": 1, "discount_pct": 100}]
            ),
            "line item: injected discount",
        ),
        (
            checkout_payload(
                shipping_address={
                    "line1": "12 Example Street",
                    "city": "Springfield",
                    "postal_code": "12345",
                    "country": "US",
                    "shipping_minor": 0,
                }
            ),
            "shipping address: injected shipping cost",
        ),
    ],
)
async def test_unknown_fields_are_rejected_at_every_level(client, products, payload, where):
    response = await client.post("/api/checkout/sessions", json=payload)
    assert response.status_code == 422, f"{where} was accepted: {response.text}"
    assert response.json()["error"]["code"] == "validation_error"


async def test_no_order_is_created_when_validation_fails(client, products):
    """A rejected request must leave no trace: no order, no reservation."""
    from sqlalchemy import func, select

    from app.db import session_scope
    from app.models import Order, Product

    await client.post(
        "/api/checkout/sessions",
        json=checkout_payload(items=[{"sku": "COF-ETH-250", "quantity": 1, "price": 0}]),
    )
    async with session_scope() as db:
        assert await db.scalar(select(func.count()).select_from(Order)) == 0
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 0
