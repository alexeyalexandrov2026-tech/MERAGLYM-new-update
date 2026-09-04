"""Payment provider webhook endpoint.

Contract with the provider:

* The raw request body is verified against the signing secret **before** it is
  parsed as anything but bytes. An unverified body is never trusted, logged in
  full, or acted upon.
* A verified event is acknowledged with 200 as soon as it is durably recorded,
  even if the side effects then fail — otherwise the provider retries an event
  we have already banked, and our own worker is the better retry mechanism.
* A duplicate event id is acknowledged with 200 and does nothing.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Header, Request, Response

from ..config import get_settings
from ..db import session_scope
from ..errors import WebhookVerificationError
from ..models import PaymentEventStatus, WebhookEvent, utcnow
from ..services import webhooks as webhook_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger(__name__)

#: Reject oversized bodies before spending CPU on signature verification.
MAX_WEBHOOK_BYTES = 1_048_576  # 1 MiB


@router.post("/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
) -> Response:
    settings = get_settings()
    gateway = request.app.state.gateway

    body = await request.body()
    if len(body) > MAX_WEBHOOK_BYTES:
        log.warning("webhook_body_too_large", extra={"bytes": len(body)})
        return Response(status_code=413)

    try:
        event = gateway.verify_and_parse_webhook(body, stripe_signature or "")
    except WebhookVerificationError as exc:
        # 400 tells the provider the delivery was malformed; it will not retry
        # forever, and a forged request gets nothing back.
        log.warning("webhook_verification_failed", extra={"reason": str(exc)})
        return Response(status_code=400, content='{"error":"invalid signature"}',
                        media_type="application/json")

    async with session_scope() as db:
        record = await webhook_service.record_event(db, event, gateway.name, body)
        if record is None:
            log.info(
                "webhook_duplicate_ignored",
                extra={"provider_event_id": event.id, "event_type": event.type},
            )
            return Response(
                content='{"status":"duplicate"}', media_type="application/json"
            )
        record_id = record.id

    if event.type not in webhook_service.HANDLED_EVENT_TYPES:
        async with session_scope() as db:
            row = await db.get(WebhookEvent, record_id)
            if row is not None:
                row.status = PaymentEventStatus.ignored
                row.processed_at = utcnow()
        return Response(content='{"status":"ignored"}', media_type="application/json")

    try:
        async with session_scope() as db:
            order_id = await webhook_service.process_event(db, event, settings)
            row = await db.get(WebhookEvent, record_id)
            if row is not None:
                row.status = PaymentEventStatus.processed
                row.processed_at = utcnow()
                row.order_id = order_id
                row.attempts += 1
    except Exception as exc:
        # Bank the failure and let our worker retry; still acknowledge, because
        # the event is durably recorded and provider retries would only race.
        log.exception(
            "webhook_processing_failed",
            extra={"provider_event_id": event.id, "event_type": event.type},
        )
        async with session_scope() as db:
            row = await db.get(WebhookEvent, record_id)
            if row is not None:
                row.status = PaymentEventStatus.failed
                row.attempts += 1
                row.error = f"{type(exc).__name__}: {exc}"[:2000]
        return Response(
            content='{"status":"accepted_pending_retry"}',
            media_type="application/json",
        )

    log.info(
        "webhook_processed",
        extra={"provider_event_id": event.id, "event_type": event.type},
    )
    return Response(content='{"status":"processed"}', media_type="application/json")
