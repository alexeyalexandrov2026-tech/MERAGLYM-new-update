"""FastAPI application: catalog, checkout, webhooks, admin, health."""

from __future__ import annotations

import base64
import hashlib
import logging
import re
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import dispose_engine, init_engine
from .errors import DomainError, RateLimitedError
from .logging_config import configure_logging, request_id_var
from .notifications import build_channel
from .payments import build_gateway
from .ratelimit import build_limiter
from .routers import admin, catalog, checkout, health, webhooks
from .security import SECURITY_HEADERS

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"

#: Vendored Swagger UI, served from our own /static so /docs works offline.
SWAGGER_UI_DIR = "/static/vendor/swagger-ui"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_format)
    init_engine(settings)
    app.state.settings = settings
    app.state.gateway = build_gateway(settings)
    app.state.channel = build_channel(settings)
    app.state.limiter = build_limiter(
        redis_url=settings.redis_url, enabled=settings.rate_limit_enabled
    )
    log.info(
        "application_started",
        extra={
            "environment": settings.environment,
            "payment_provider": settings.payment_provider,
            "email_backend": settings.email_backend,
            "rate_limit_enabled": settings.rate_limit_enabled,
        },
    )
    if not settings.is_production and settings.environment == "development":
        # Dev convenience: the ephemeral admin key is otherwise unknowable.
        log.warning("dev_admin_api_key", extra={"admin_api_key": settings.admin_api_key})
    try:
        yield
    finally:
        await app.state.limiter.close()
        await dispose_engine()
        log.info("application_stopped")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Meduza V",
        version="1.0.0",
        description=(
            "Continuously running storefront for lawful general merchandise: "
            "catalog, provider-hosted checkout, verified webhooks, receipts, "
            "inventory and fulfilment."
        ),
        lifespan=lifespan,
        # No interactive docs in production: they advertise the admin surface.
        # /docs is registered by hand below so it can carry its own CSP.
        docs_url=None,
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    # The storefront is a separate origin; the API itself is not credentialed
    # by cookies, so a permissive-but-explicit CORS policy is appropriate.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.public_base_url],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "Idempotency-Key"],
        max_age=600,
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming[:64] if incoming.isascii() and incoming else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        return response

    @app.exception_handler(DomainError)
    async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
        headers = {}
        if isinstance(exc, RateLimitedError):
            headers["Retry-After"] = str(exc.retry_after)
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            },
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "The request payload is invalid.",
                    # Pydantic's own detail, minus any echoed input values.
                    "details": {
                        "fields": [
                            {"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")}
                            for e in exc.errors()
                        ]
                    },
                }
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        # Log the detail; return none of it. Stack traces are not a client
        # concern and often leak schema or configuration.
        log.exception("unhandled_exception", extra={"path": request.url.path})
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected error occurred.",
                    "details": {},
                }
            },
        )

    app.include_router(health.router)
    app.include_router(catalog.router)
    app.include_router(checkout.router)
    app.include_router(webhooks.router)
    app.include_router(admin.router)

    # The storefront. One page, served on the landing route and on both
    # return-from-payment routes: the provider redirects back with
    # ?order=&token= and the page renders that order's status from the API.
    storefront = STATIC_DIR / "storefront.html"
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    # The API's default CSP is `default-src 'none'`, which is right for JSON but
    # would block the page itself. The storefront gets its own policy: same-origin
    # only, no inline scripts (the script is a separate file), and the one font
    # host it uses. Inline style is allowed; inline script is not.
    STOREFRONT_CSP = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    )

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    @app.get(settings.storefront_success_path, response_class=HTMLResponse, include_in_schema=False)
    @app.get(settings.storefront_cancel_path, response_class=HTMLResponse, include_in_schema=False)
    async def serve_storefront() -> HTMLResponse:
        # Set here so the security middleware's setdefault() leaves it alone.
        return HTMLResponse(
            storefront.read_text(encoding="utf-8"),
            headers={"Content-Security-Policy": STOREFRONT_CSP},
        )

    # Swagger UI, served by hand for two reasons. The API-wide
    # `default-src 'none'` blocks its assets and its inline bootstrap, so
    # FastAPI's built-in /docs renders a blank page under this app's own
    # security headers; and its default asset URLs point at a CDN, which the
    # offline demo installer cannot reach. So the assets are vendored under
    # /static, the route carries a CSP scoped to itself, and the inline
    # bootstrap is pinned by SHA-256 hash rather than allowing 'unsafe-inline'.
    # The result loads nothing from outside this process.
    if not settings.is_production:
        _docs_html = get_swagger_ui_html(
            openapi_url="/openapi.json",
            title="Meduza V — API",
            swagger_js_url=f"{SWAGGER_UI_DIR}/swagger-ui-bundle.js",
            swagger_css_url=f"{SWAGGER_UI_DIR}/swagger-ui.css",
            swagger_favicon_url="/static/favicon.svg",
        ).body.decode()
        _inline = re.findall(r"<script[^>]*>(.*?)</script>", _docs_html, re.S)
        _hashes = " ".join(
            "'sha256-" + base64.b64encode(hashlib.sha256(b.encode()).digest()).decode() + "'"
            for b in _inline
            if b.strip()
        )
        DOCS_CSP = (
            "default-src 'none'; "
            f"script-src 'self' {_hashes}; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )

        @app.get("/docs", include_in_schema=False)
        async def swagger_ui() -> HTMLResponse:
            return HTMLResponse(
                _docs_html, headers={"Content-Security-Policy": DOCS_CSP}
            )

    return app


app = create_app()
