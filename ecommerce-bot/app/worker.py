"""The always-on background worker.

Runs as a separate process from the web tier and performs the work that must
keep happening whether or not anyone is browsing:

* **drain the outbox** — deliver receipts with exponential backoff, dead-letter
  what will never succeed;
* **expire stale reservations** — release stock held by checkouts the buyer
  abandoned, so inventory does not leak;
* **retry failed webhooks** — reprocess events banked by the endpoint whose
  side effects failed;
* **reclaim orphaned locks** — return work claimed by a worker that died.

Every pass is wrapped so that one failing job never stops the loop, and the
process exits cleanly on SIGTERM so a rolling deploy drains rather than drops.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import os
import signal
import socket

from sqlalchemy import select

from .config import Settings, get_settings
from .db import dispose_engine, init_engine, session_scope
from .logging_config import configure_logging
from .models import (
    Order,
    OrderStatus,
    OutboxMessage,
    PaymentEventStatus,
    WebhookEvent,
    utcnow,
)
from .notifications import NotificationChannel, build_channel
from .payments import PaymentGateway, build_gateway
from .services import inventory, orders, outbox

log = logging.getLogger(__name__)

#: Give up reprocessing a webhook after this many attempts; it needs a human.
MAX_WEBHOOK_ATTEMPTS = 10


class Worker:
    def __init__(
        self,
        settings: Settings,
        channel: NotificationChannel,
        gateway: PaymentGateway,
    ) -> None:
        self.settings = settings
        self.channel = channel
        self.gateway = gateway
        self.worker_id = f"{socket.gethostname()}:{os.getpid()}"
        self._stop = asyncio.Event()

    def request_stop(self) -> None:
        log.info("worker_stop_requested", extra={"worker_id": self.worker_id})
        self._stop.set()

    # -- jobs --------------------------------------------------------------
    async def drain_outbox(self) -> int:
        delivered = 0
        async with session_scope() as db:
            await outbox.reclaim_expired_locks(db)
            messages = await outbox.claim_batch(
                db,
                worker_id=self.worker_id,
                limit=self.settings.worker_batch_size,
                lock_seconds=self.settings.outbox_lock_seconds,
            )
            message_ids = [m.id for m in messages]

        for message_id in message_ids:
            async with session_scope() as db:
                message = await db.get(OutboxMessage, message_id)
                if message is None:
                    continue
                if await outbox.deliver(
                    db, message, self.channel, worker_id=self.worker_id
                ):
                    delivered += 1
        return delivered

    async def expire_stale_reservations(self) -> int:
        """Release stock for checkouts that were never paid.

        Also asks the provider to expire its own session, so a buyer cannot
        pay for stock we have already given back.
        """
        released = 0
        async with session_scope() as db:
            stale = (
                await db.execute(
                    select(Order)
                    .where(
                        Order.status == OrderStatus.pending_payment,
                        Order.reservation_expires_at.is_not(None),
                        Order.reservation_expires_at < utcnow(),
                    )
                    .limit(self.settings.worker_batch_size)
                )
            ).scalars().all()
            order_ids = [(o.id, o.provider_session_id) for o in stale]

        for order_id, session_id in order_ids:
            if session_id:
                with contextlib.suppress(Exception):
                    await self.gateway.expire_checkout_session(session_id)
            async with session_scope() as db:
                order = await orders.get_by_id(db, order_id, for_update=True)
                if order.status is not OrderStatus.pending_payment:
                    continue  # a webhook beat us to it
                await inventory.release(db, order)
                orders.transition(order, OrderStatus.expired, strict=False)
                order.failure_reason = "the checkout session expired"
                released += 1
                log.info("reservation_expired", extra={"order_id": order.id})
        return released

    async def retry_failed_webhooks(self) -> int:
        """Reprocess events whose side effects failed at ingestion time."""
        from .services import webhooks as webhook_service

        cutoff = utcnow() - dt.timedelta(seconds=self.settings.webhook_retry_after_seconds)
        async with session_scope() as db:
            stuck = (
                await db.execute(
                    select(WebhookEvent)
                    .where(
                        WebhookEvent.status.in_(
                            [PaymentEventStatus.failed, PaymentEventStatus.received]
                        ),
                        WebhookEvent.received_at < cutoff,
                        WebhookEvent.attempts < MAX_WEBHOOK_ATTEMPTS,
                    )
                    .order_by(WebhookEvent.received_at)
                    .limit(self.settings.worker_batch_size)
                )
            ).scalars().all()
            stuck_ids = [row.id for row in stuck]

        retried = 0
        for event_id in stuck_ids:
            async with session_scope() as db:
                record = await db.get(WebhookEvent, event_id)
                if record is None:
                    continue
                record.attempts += 1
                event = webhook_service.event_from_record(record)
                if event is None:
                    record.status = PaymentEventStatus.failed
                    record.error = "no stored payload; replay from the provider dashboard"
                    continue
                try:
                    record.order_id = await webhook_service.process_event(
                        db, event, self.settings
                    )
                except Exception as exc:
                    record.status = PaymentEventStatus.failed
                    record.error = f"{type(exc).__name__}: {exc}"[:2000]
                    log.exception(
                        "webhook_retry_failed",
                        extra={"provider_event_id": record.provider_event_id},
                    )
                    continue
                record.status = PaymentEventStatus.processed
                record.processed_at = utcnow()
                record.error = None
                retried += 1
                log.info(
                    "webhook_retry_succeeded",
                    extra={"provider_event_id": record.provider_event_id},
                )
        return retried

    # -- loop --------------------------------------------------------------
    async def run_once(self) -> dict[str, int]:
        results: dict[str, int] = {}
        for name, job in (
            ("receipts_delivered", self.drain_outbox),
            ("reservations_expired", self.expire_stale_reservations),
            ("webhooks_retried", self.retry_failed_webhooks),
        ):
            try:
                results[name] = await job()
            except Exception:
                log.exception("worker_job_failed", extra={"job": name})
                results[name] = -1
        return results

    async def run_forever(self) -> None:
        log.info("worker_started", extra={"worker_id": self.worker_id})
        while not self._stop.is_set():
            results = await self.run_once()
            if any(v > 0 for v in results.values()):
                log.info("worker_pass", extra=results)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.settings.worker_poll_interval_seconds
                )
        log.info("worker_stopped", extra={"worker_id": self.worker_id})


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_format)
    init_engine(settings)
    worker = Worker(settings, build_channel(settings), build_gateway(settings))

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, worker.request_stop)

    try:
        await worker.run_forever()
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
