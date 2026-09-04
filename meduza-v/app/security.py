"""Authentication, client identification, and security headers."""

from __future__ import annotations

import logging
import secrets

from fastapi import Depends, Header, Request

from .config import Settings, get_settings
from .errors import AuthError, RateLimitedError
from .models import AdminAuditLog
from .ratelimit import RateLimiter

log = logging.getLogger(__name__)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


def client_ip(request: Request, settings: Settings) -> str:
    """Resolve the caller's address.

    ``X-Forwarded-For`` is only consulted when ``TRUSTED_PROXY_HOPS`` says how
    many proxies sit in front of us. Trusting the header blindly would let any
    client forge its own rate-limit identity.
    """
    hops = settings.trusted_proxy_hops
    if hops > 0:
        forwarded = request.headers.get("x-forwarded-for", "")
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return request.client.host if request.client else "unknown"


def get_limiter(request: Request) -> RateLimiter:
    return request.app.state.limiter


async def enforce_rate_limit(
    request: Request, *, bucket: str, limit: int, settings: Settings
) -> None:
    limiter: RateLimiter = request.app.state.limiter
    key = f"{bucket}:{client_ip(request, settings)}"
    allowed, retry_after = await limiter.check(key, limit)
    if not allowed:
        log.warning("rate_limited", extra={"bucket": bucket, "path": request.url.path})
        raise RateLimitedError("Too many requests. Please slow down.", retry_after)


def public_rate_limit(bucket: str, limit_attr: str):
    """Dependency factory for a named rate-limit bucket."""

    async def _dependency(
        request: Request, settings: Settings = Depends(get_settings)
    ) -> None:
        await enforce_rate_limit(
            request,
            bucket=bucket,
            limit=getattr(settings, limit_attr),
            settings=settings,
        )

    return _dependency


async def require_admin(
    request: Request,
    x_admin_api_key: str | None = Header(default=None, alias="X-Admin-Api-Key"),
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> str:
    """Authenticate an administrative caller.

    Admin requests are rate limited *before* the key is checked, so the endpoint
    cannot be used as an oracle to brute-force the key at full speed. The
    comparison itself is constant time.
    """
    await enforce_rate_limit(
        request,
        bucket="admin",
        limit=settings.rate_limit_admin_per_minute,
        settings=settings,
    )
    presented = x_admin_api_key
    if not presented and authorization and authorization.lower().startswith("bearer "):
        presented = authorization[7:]
    expected = settings.admin_api_key
    if not expected or not presented or not secrets.compare_digest(presented, expected):
        log.warning(
            "admin_auth_failed",
            extra={"path": request.url.path, "ip": client_ip(request, settings)},
        )
        raise AuthError("Administrative credentials are required.")
    return "admin"


def audit(
    *,
    actor: str,
    action: str,
    request: Request,
    settings: Settings,
    subject_type: str | None = None,
    subject_id: str | None = None,
    detail: dict | None = None,
) -> AdminAuditLog:
    from .logging_config import request_id_var

    return AdminAuditLog(
        actor=actor,
        action=action,
        subject_type=subject_type,
        subject_id=subject_id,
        request_id=request_id_var.get(),
        source_ip=client_ip(request, settings),
        detail=detail,
    )
