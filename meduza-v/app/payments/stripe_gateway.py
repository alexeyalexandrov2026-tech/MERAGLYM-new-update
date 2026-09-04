"""Stripe implementation of :class:`PaymentGateway`.

PROVIDER-SPECIFIC CONFIGURATION REQUIRED — see README "Stripe setup".

Only documented stripe-python surface is used:

* ``stripe.checkout.Session.create`` / ``.expire``   (Checkout Sessions API)
* ``stripe.Refund.create``                           (Refunds API)
* ``stripe.Webhook.construct_event``                 (signature verification)

stripe-python's module-level helpers are synchronous and perform blocking HTTP,
so every call is offloaded to a worker thread to keep the event loop free.
"""

from __future__ import annotations

import datetime as dt
import functools
import logging
from typing import Any

import anyio.to_thread
import stripe

from ..errors import PaymentProviderError, WebhookVerificationError
from .base import (
    CheckoutSessionResult,
    CheckoutSessionSpec,
    PaymentEvent,
    RefundResult,
)

log = logging.getLogger(__name__)

#: Stripe refund reasons are a closed enum; anything else must go in metadata.
_ALLOWED_REFUND_REASONS = {"duplicate", "fraudulent", "requested_by_customer"}


class StripeGateway:
    name = "stripe"

    def __init__(
        self,
        api_key: str,
        webhook_secret: str,
        *,
        api_version: str = "",
        max_network_retries: int = 2,
    ) -> None:
        if not api_key:
            raise ValueError("Stripe API key is required")
        if not webhook_secret:
            raise ValueError("Stripe webhook signing secret is required")
        self._api_key = api_key
        self._webhook_secret = webhook_secret
        self._api_version = api_version or None
        self._max_network_retries = max_network_retries

    # -- internals ---------------------------------------------------------
    def _options(self, idempotency_key: str | None = None) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "api_key": self._api_key,
            "max_network_retries": self._max_network_retries,
        }
        if self._api_version:
            opts["stripe_version"] = self._api_version
        if idempotency_key:
            opts["idempotency_key"] = idempotency_key
        return opts

    @staticmethod
    async def _call(fn, /, *args, **kwargs):
        """Run a blocking stripe-python call off the event loop."""
        try:
            return await anyio.to_thread.run_sync(
                functools.partial(fn, *args, **kwargs)
            )
        except stripe.CardError as exc:  # declined card — buyer-actionable
            raise PaymentProviderError(
                exc.user_message or "The card was declined.",
                details={"decline_code": getattr(exc, "code", None)},
            ) from exc
        except stripe.IdempotencyError as exc:
            raise PaymentProviderError(
                "This request was already made with different parameters."
            ) from exc
        except stripe.InvalidRequestError as exc:
            log.error("stripe_invalid_request", extra={"stripe_error": str(exc)})
            raise PaymentProviderError("The payment request was rejected.") from exc
        except (stripe.APIConnectionError, stripe.RateLimitError) as exc:
            raise PaymentProviderError(
                "The payment provider is temporarily unavailable."
            ) from exc
        except stripe.StripeError as exc:
            log.exception("stripe_error")
            raise PaymentProviderError("Payment provider error.") from exc

    # -- checkout ----------------------------------------------------------
    async def create_checkout_session(
        self, spec: CheckoutSessionSpec
    ) -> CheckoutSessionResult:
        line_items = [
            {
                "quantity": item.quantity,
                "price_data": {
                    "currency": item.currency,
                    "unit_amount": item.unit_amount_minor,
                    "product_data": {
                        "name": item.name,
                        **({"description": item.description} if item.description else {}),
                        **({"images": [item.image_url]} if item.image_url else {}),
                    },
                },
            }
            for item in spec.line_items
        ]
        params: dict[str, Any] = {
            "mode": "payment",
            "line_items": line_items,
            "customer_email": spec.customer_email,
            "client_reference_id": spec.order_id,
            "success_url": spec.success_url,
            "cancel_url": spec.cancel_url,
            "expires_at": int(spec.expires_at.timestamp()),
            "metadata": spec.metadata,
            # Mirror metadata onto the PaymentIntent so charge/refund events
            # can be traced back to the order without an extra API round-trip.
            "payment_intent_data": {"metadata": spec.metadata},
        }
        session = await self._call(
            stripe.checkout.Session.create,
            **params,
            **self._options(spec.idempotency_key),
        )
        url = session.get("url")
        if not url:
            raise PaymentProviderError("Stripe did not return a checkout URL.")
        expires_at = session.get("expires_at")
        return CheckoutSessionResult(
            session_id=session["id"],
            url=url,
            expires_at=(
                dt.datetime.fromtimestamp(expires_at, tz=dt.UTC)
                if expires_at
                else None
            ),
            payment_intent_id=_as_id(session.get("payment_intent")),
        )

    async def expire_checkout_session(self, session_id: str) -> None:
        try:
            await self._call(
                stripe.checkout.Session.expire, session_id, **self._options()
            )
        except PaymentProviderError:
            # Already expired/completed sessions are not an error for us.
            log.info("stripe_session_expire_noop", extra={"session_id": session_id})

    # -- refunds -----------------------------------------------------------
    async def create_refund(
        self,
        *,
        payment_intent_id: str,
        amount_minor: int | None,
        reason: str | None,
        idempotency_key: str,
    ) -> RefundResult:
        params: dict[str, Any] = {"payment_intent": payment_intent_id}
        if amount_minor is not None:
            params["amount"] = amount_minor
        if reason in _ALLOWED_REFUND_REASONS:
            params["reason"] = reason
        elif reason:
            params["metadata"] = {"internal_reason": reason[:500]}
        refund = await self._call(
            stripe.Refund.create, **params, **self._options(idempotency_key)
        )
        return RefundResult(
            refund_id=refund["id"],
            status=refund.get("status") or "pending",
            amount_minor=int(refund.get("amount") or 0),
            currency=(refund.get("currency") or "").lower(),
        )

    # -- webhooks ----------------------------------------------------------
    def verify_and_parse_webhook(self, payload: bytes, signature: str) -> PaymentEvent:
        if not signature:
            raise WebhookVerificationError("Missing Stripe-Signature header.")
        try:
            event = stripe.Webhook.construct_event(
                payload, signature, self._webhook_secret
            )
        except stripe.SignatureVerificationError as exc:
            raise WebhookVerificationError("Invalid webhook signature.") from exc
        except ValueError as exc:
            raise WebhookVerificationError("Malformed webhook payload.") from exc
        raw = dict(event)
        return PaymentEvent(
            id=raw["id"],
            type=raw["type"],
            created=dt.datetime.fromtimestamp(
                raw.get("created", 0), tz=dt.UTC
            ),
            data=dict(raw.get("data", {}).get("object", {})),
            raw=raw,
        )


def _as_id(value: Any) -> str | None:
    """Stripe returns either an id string or an expanded object."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.get("id")
