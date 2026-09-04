"""Payment gateway abstraction.

The rest of the application talks only to this interface, which keeps the
Stripe-specific surface confined to ``stripe_gateway.py`` and makes the whole
payment path testable without network access.

Two invariants hold for every implementation:

1. Checkout is **hosted by the provider**. This service never receives, renders,
   proxies, or persists a PAN, CVC, or expiry. It only ever handles opaque
   provider identifiers.
2. Webhooks are **cryptographically verified** before the payload is parsed as
   anything other than bytes.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from typing import Any, Protocol, runtime_checkable


@dataclasses.dataclass(frozen=True, slots=True)
class LineItemSpec:
    name: str
    description: str
    unit_amount_minor: int
    quantity: int
    currency: str
    image_url: str | None = None


@dataclasses.dataclass(frozen=True, slots=True)
class CheckoutSessionSpec:
    order_id: str
    order_reference: str
    customer_email: str
    currency: str
    line_items: tuple[LineItemSpec, ...]
    success_url: str
    cancel_url: str
    expires_at: dt.datetime
    metadata: dict[str, str]
    idempotency_key: str


@dataclasses.dataclass(frozen=True, slots=True)
class CheckoutSessionResult:
    session_id: str
    url: str
    expires_at: dt.datetime | None
    payment_intent_id: str | None = None


@dataclasses.dataclass(frozen=True, slots=True)
class RefundResult:
    refund_id: str
    status: str          # "pending" | "succeeded" | "failed" | "cancelled"
    amount_minor: int
    currency: str


@dataclasses.dataclass(frozen=True, slots=True)
class PaymentEvent:
    """A verified, normalised provider event."""

    id: str
    type: str
    created: dt.datetime
    data: dict[str, Any]
    raw: dict[str, Any]


@runtime_checkable
class PaymentGateway(Protocol):
    name: str

    async def create_checkout_session(
        self, spec: CheckoutSessionSpec
    ) -> CheckoutSessionResult: ...

    async def expire_checkout_session(self, session_id: str) -> None: ...

    async def create_refund(
        self,
        *,
        payment_intent_id: str,
        amount_minor: int | None,
        reason: str | None,
        idempotency_key: str,
    ) -> RefundResult: ...

    def verify_and_parse_webhook(self, payload: bytes, signature: str) -> PaymentEvent: ...
