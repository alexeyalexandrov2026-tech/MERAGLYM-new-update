"""In-memory payment gateway for tests and offline development.

It deliberately reuses Stripe's *real* signature verification
(``stripe.Webhook.construct_event``) so the webhook security path under test is
the same code that runs in production; only the outbound API calls are faked.
"""

from __future__ import annotations

import datetime as dt
import json
import secrets
import time

import stripe

from ..errors import PaymentProviderError, WebhookVerificationError
from .base import (
    CheckoutSessionResult,
    CheckoutSessionSpec,
    PaymentEvent,
    RefundResult,
)


class FakeGateway:
    name = "fake"

    def __init__(self, webhook_secret: str = "whsec_test_secret") -> None:
        self._webhook_secret = webhook_secret
        self.sessions: dict[str, dict] = {}
        self.refunds: dict[str, dict] = {}
        self.expired: list[str] = []
        #: Set to raise from the next outbound call, to test error handling.
        self.fail_next: Exception | None = None
        #: Idempotency-key -> session id, mirroring provider replay semantics.
        self._idempotency: dict[str, str] = {}

    def _maybe_fail(self) -> None:
        if self.fail_next is not None:
            exc, self.fail_next = self.fail_next, None
            raise exc

    async def create_checkout_session(
        self, spec: CheckoutSessionSpec
    ) -> CheckoutSessionResult:
        self._maybe_fail()
        if spec.idempotency_key in self._idempotency:
            session_id = self._idempotency[spec.idempotency_key]
            stored = self.sessions[session_id]
            return CheckoutSessionResult(
                session_id=session_id,
                url=stored["url"],
                expires_at=spec.expires_at,
                payment_intent_id=stored["payment_intent"],
            )
        session_id = f"cs_test_{secrets.token_hex(12)}"
        payment_intent_id = f"pi_test_{secrets.token_hex(12)}"
        total = sum(i.unit_amount_minor * i.quantity for i in spec.line_items)
        self.sessions[session_id] = {
            "id": session_id,
            "url": f"https://checkout.example.test/pay/{session_id}",
            "payment_intent": payment_intent_id,
            "amount_total": total,
            "currency": spec.currency,
            "client_reference_id": spec.order_id,
            "metadata": dict(spec.metadata),
            "customer_email": spec.customer_email,
        }
        self._idempotency[spec.idempotency_key] = session_id
        return CheckoutSessionResult(
            session_id=session_id,
            url=self.sessions[session_id]["url"],
            expires_at=spec.expires_at,
            payment_intent_id=payment_intent_id,
        )

    async def expire_checkout_session(self, session_id: str) -> None:
        self.expired.append(session_id)

    async def create_refund(
        self,
        *,
        payment_intent_id: str,
        amount_minor: int | None,
        reason: str | None,
        idempotency_key: str,
    ) -> RefundResult:
        self._maybe_fail()
        for existing in self.refunds.values():
            if existing["idempotency_key"] == idempotency_key:
                return RefundResult(
                    refund_id=existing["id"],
                    status=existing["status"],
                    amount_minor=existing["amount"],
                    currency=existing["currency"],
                )
        session = next(
            (s for s in self.sessions.values() if s["payment_intent"] == payment_intent_id),
            None,
        )
        if session is None:
            raise PaymentProviderError("Unknown payment intent.")
        amount = amount_minor if amount_minor is not None else session["amount_total"]
        refund_id = f"re_test_{secrets.token_hex(12)}"
        self.refunds[refund_id] = {
            "id": refund_id,
            "status": "succeeded",
            "amount": amount,
            "currency": session["currency"],
            "payment_intent": payment_intent_id,
            "idempotency_key": idempotency_key,
        }
        return RefundResult(
            refund_id=refund_id,
            status="succeeded",
            amount_minor=amount,
            currency=session["currency"],
        )

    # -- webhooks (real verification, fake transport) -----------------------
    def verify_and_parse_webhook(self, payload: bytes, signature: str) -> PaymentEvent:
        if not signature:
            raise WebhookVerificationError("Missing signature header.")
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
            created=dt.datetime.fromtimestamp(raw.get("created", 0), tz=dt.UTC),
            data=dict(raw.get("data", {}).get("object", {})),
            raw=raw,
        )

    # -- test helpers -------------------------------------------------------
    def sign(self, payload: dict, *, timestamp: int | None = None) -> tuple[bytes, str]:
        """Produce (body, Stripe-Signature) using the documented v1 scheme."""
        body = json.dumps(payload, separators=(",", ":")).encode()
        ts = timestamp or int(time.time())
        signature = stripe.WebhookSignature._compute_signature(
            f"{ts}.{body.decode()}", self._webhook_secret
        )
        return body, f"t={ts},v1={signature}"
