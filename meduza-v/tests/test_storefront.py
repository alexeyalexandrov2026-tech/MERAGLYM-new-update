"""The storefront is served under its own CSP; keep the two in agreement.

The page ships `script-src 'self'` and no `'unsafe-inline'`, which blocks inline
`on*` event handlers as well as inline <script> blocks. A storefront written with
`onclick="..."` therefore renders correctly and is completely unclickable, with
the only symptom a console warning no server-side test would ever see. These
tests pin the invariant instead.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STATIC = Path(__file__).resolve().parents[1] / "app" / "static"
STOREFRONT_FILES = [STATIC / "storefront.html", STATIC / "storefront.js"]

INLINE_HANDLER = re.compile(r"""\son[a-z]+\s*=\s*["']""", re.IGNORECASE)


@pytest.mark.parametrize("path", STOREFRONT_FILES, ids=lambda p: p.name)
def test_no_inline_event_handlers(path: Path) -> None:
    found = INLINE_HANDLER.findall(path.read_text(encoding="utf-8"))
    assert not found, (
        f"{path.name} uses inline event handlers {found}, which the storefront's "
        "own Content-Security-Policy blocks. Use data-act attributes and the "
        "delegated listener in storefront.js instead."
    )


def test_storefront_html_has_no_inline_script_block() -> None:
    html = (STATIC / "storefront.html").read_text(encoding="utf-8")
    for match in re.finditer(r"<script\b([^>]*)>(.*?)</script>", html, re.S | re.I):
        attrs, body = match.groups()
        assert "src=" in attrs.lower(), "inline <script> is blocked by script-src 'self'"
        assert not body.strip()


async def test_storefront_is_served_with_its_csp(client) -> None:
    resp = await client.get("/")
    assert resp.status_code == 200
    csp = resp.headers["content-security-policy"]
    assert "script-src 'self'" in csp
    assert "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]
    assert "frame-ancestors 'none'" in csp


async def test_storefront_script_is_served(client) -> None:
    resp = await client.get("/static/storefront.js")
    assert resp.status_code == 200
    assert "data-act" in resp.text


# --- /docs -------------------------------------------------------------------
# The docs page is the other route that renders HTML under an API-wide
# `default-src 'none'`. It has already failed twice in ways no request-level
# assertion would catch: once rendering blank because the CSP blocked its
# assets, and once rendering "the provided definition does not specify a valid
# version field" because the vendored Swagger UI predated OpenAPI 3.1. These
# pin both.

VENDOR = STATIC / "vendor" / "swagger-ui"


def test_swagger_ui_is_vendored() -> None:
    for name in ("swagger-ui-bundle.js", "swagger-ui.css", "LICENSE"):
        f = VENDOR / name
        assert f.is_file(), f"{name} is missing; /docs cannot work offline without it"
        assert f.stat().st_size > 1024


def test_vendored_swagger_understands_openapi_31() -> None:
    # FastAPI emits OpenAPI 3.1; Swagger UI 4.x refuses it outright. The 5.x
    # bundles carry an OpenAPI31 plugin, so its absence means the vendored
    # bundle was downgraded and /docs will render an error instead of the API.
    bundle = (VENDOR / "swagger-ui-bundle.js").read_text(encoding="utf-8", errors="replace")
    assert "OpenAPI31" in bundle, (
        "the vendored Swagger UI has no OpenAPI 3.1 support; /docs will show "
        "'the provided definition does not specify a valid version field'"
    )


async def test_docs_loads_nothing_from_outside(client) -> None:
    resp = await client.get("/docs")
    assert resp.status_code == 200
    # Every asset the page pulls must be same-origin.
    for scheme in ("http://", "https://"):
        assert scheme not in resp.text, f"/docs references an external {scheme} asset"
    csp = resp.headers["content-security-policy"]
    assert "script-src 'self' 'sha256-" in csp
    assert "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]


async def test_docs_assets_are_served(client) -> None:
    for path, allowed in (
        ("/static/vendor/swagger-ui/swagger-ui-bundle.js",
         ("text/javascript", "application/javascript")),
        ("/static/vendor/swagger-ui/swagger-ui.css", ("text/css",)),
    ):
        r = await client.get(path)
        assert r.status_code == 200, path
        # A wrong type here is silent: the browser refuses the asset and the
        # page renders blank with only a console warning.
        assert r.headers["content-type"].startswith(allowed), (
            f"{path} served as {r.headers['content-type']}; the browser will refuse it"
        )
