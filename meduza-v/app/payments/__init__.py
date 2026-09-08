"""Payment gateway factory."""

from __future__ import annotations

from functools import lru_cache

from ..config import Settings, get_settings
from .base import (
    CheckoutSessionResult,
    CheckoutSessionSpec,
    LineItemSpec,
    PaymentEvent,
    PaymentGateway,
    RefundResult,
)

__all__ = [
    "CheckoutSessionResult",
    "CheckoutSessionSpec",
    "LineItemSpec",
    "PaymentEvent",
    "PaymentGateway",
    "RefundResult",
    "build_gateway",
    "get_gateway",
]


def build_gateway(settings: Settings) -> PaymentGateway:
    if settings.payment_provider == "stripe":
        from .stripe_gateway import StripeGateway

        return StripeGateway(
            api_key=settings.stripe_api_key,
            webhook_secret=settings.stripe_webhook_secret,
            api_version=settings.stripe_api_version,
        )
    from .fake import FakeGateway

    return FakeGateway(settings.stripe_webhook_secret or "whsec_test_secret")


@lru_cache(maxsize=1)
def get_gateway() -> PaymentGateway:
    return build_gateway(get_settings())
