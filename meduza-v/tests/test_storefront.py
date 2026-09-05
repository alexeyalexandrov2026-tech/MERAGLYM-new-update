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
