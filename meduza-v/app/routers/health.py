"""Liveness, readiness, and a minimal Prometheus exposition."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select, text

from ..config import Settings, get_settings
from ..db import session_scope
from ..models import OrderStatus, OutboxStatus
from ..schemas import HealthOut

router = APIRouter(tags=["ops"])
log = logging.getLogger(__name__)

_STARTED_AT = time.time()


@router.get("/healthz", response_model=HealthOut)
async def liveness() -> HealthOut:
    """Liveness: is the process running? Deliberately touches no dependency,
    so a database blip never causes the orchestrator to kill healthy pods."""
    return HealthOut(status="ok", checks={"process": "ok"})


@router.get("/readyz", response_model=HealthOut)
async def readiness(settings: Settings = Depends(get_settings)) -> Response:
    """Readiness: should this instance receive traffic?"""
    checks: dict[str, str] = {}
    healthy = True

    try:
        async with session_scope() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        healthy = False
        checks["database"] = f"error: {type(exc).__name__}"
        log.exception("readiness_db_check_failed")

    checks["payment_provider"] = (
        "configured"
        if settings.payment_provider != "stripe" or settings.stripe_api_key
        else "missing_api_key"
    )
    checks["webhook_secret"] = (
        "configured"
        if settings.payment_provider != "stripe" or settings.stripe_webhook_secret
        else "missing"
    )
    checks["email_backend"] = settings.email_backend
    if "missing" in checks["payment_provider"] or checks["webhook_secret"] == "missing":
        healthy = False

    body = HealthOut(status="ok" if healthy else "error", checks=checks)
    return Response(
        content=body.model_dump_json(),
        media_type="application/json",
        status_code=200 if healthy else 503,
    )


@router.get("/metrics", response_class=Response)
async def metrics() -> Response:
    """Prometheus text exposition of the numbers an operator actually pages on.

    Deliberately dependency-free: these are cheap aggregate queries, not a
    full metrics client.
    """
    from ..models import Order, OutboxMessage

    lines = [
        "# HELP meduza_uptime_seconds Seconds since process start.",
        "# TYPE meduza_uptime_seconds gauge",
        f"meduza_uptime_seconds {time.time() - _STARTED_AT:.0f}",
    ]
    try:
        async with session_scope() as session:
            order_rows = (
                await session.execute(
                    select(Order.status, func.count()).group_by(Order.status)
                )
            ).all()
            outbox_rows = (
                await session.execute(
                    select(OutboxMessage.status, func.count()).group_by(
                        OutboxMessage.status
                    )
                )
            ).all()
        lines += [
            "# HELP meduza_orders_total Orders by status.",
            "# TYPE meduza_orders_total gauge",
        ]
        counts = {status.value: 0 for status in OrderStatus}
        counts.update({row[0].value: int(row[1]) for row in order_rows})
        lines += [
            f'meduza_orders_total{{status="{name}"}} {value}'
            for name, value in sorted(counts.items())
        ]

        lines += [
            "# HELP meduza_outbox_messages_total Receipt queue depth by status.",
            "# TYPE meduza_outbox_messages_total gauge",
        ]
        outbox_counts = {status.value: 0 for status in OutboxStatus}
        outbox_counts.update({row[0].value: int(row[1]) for row in outbox_rows})
        lines += [
            f'meduza_outbox_messages_total{{status="{name}"}} {value}'
            for name, value in sorted(outbox_counts.items())
        ]
    except Exception:
        log.exception("metrics_query_failed")
        lines.append("meduza_metrics_scrape_errors_total 1")

    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
