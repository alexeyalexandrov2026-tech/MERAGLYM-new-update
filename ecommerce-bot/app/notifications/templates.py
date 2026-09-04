"""Receipt rendering.

Autoescaping is on for the HTML template, so customer-supplied values (name,
address) cannot inject markup into the receipt.
"""

from __future__ import annotations

import datetime as dt

from jinja2 import Environment, select_autoescape

from ..money import format_amount

_env = Environment(autoescape=select_autoescape(["html", "xml"]), trim_blocks=True, lstrip_blocks=True)
_env.filters["money"] = format_amount

_RECEIPT_TEXT = _env.from_string(
    """{{ store_name }} — receipt for order {{ order.reference }}

Thank you{% if order.customer_name %}, {{ order.customer_name }}{% endif %}.
We received your payment on {{ paid_at }}.

Items
-----
{% for item in order.items %}
{{ item.quantity }} x {{ item.name }} ({{ item.sku }})  {{ item.line_total_minor | money(order.currency) }}
{% endfor %}

Subtotal: {{ order.subtotal_minor | money(order.currency) }}
Shipping: {{ order.shipping_minor | money(order.currency) }}
Total paid: {{ order.total_minor | money(order.currency) }}
{% if order.amount_refunded_minor %}
Refunded: {{ order.amount_refunded_minor | money(order.currency) }}
{% endif %}

{% if order.shipping_address %}
Shipping to:
{{ order.shipping_address.line1 }}
{% if order.shipping_address.line2 %}{{ order.shipping_address.line2 }}
{% endif %}
{{ order.shipping_address.city }}, {{ order.shipping_address.postal_code }}
{{ order.shipping_address.country }}
{% endif %}

Track your order: {{ status_url }}

This receipt was generated automatically. Card details are handled entirely by
our payment provider and are never stored by this store.
"""
)

_RECEIPT_HTML = _env.from_string(
    """<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a1a;">
<h2 style="margin:0 0 4px;">{{ store_name }}</h2>
<p style="margin:0 0 16px;color:#555;">Receipt for order <strong>{{ order.reference }}</strong></p>
<p>Thank you{% if order.customer_name %}, {{ order.customer_name }}{% endif %}. We received your payment on {{ paid_at }}.</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:560px;">
  <thead><tr style="text-align:left;border-bottom:1px solid #ddd;">
    <th>Item</th><th>Qty</th><th style="text-align:right;">Amount</th>
  </tr></thead>
  <tbody>
  {% for item in order.items %}
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td>{{ item.name }}<br><small style="color:#777;">{{ item.sku }}</small></td>
      <td>{{ item.quantity }}</td>
      <td style="text-align:right;">{{ item.line_total_minor | money(order.currency) }}</td>
    </tr>
  {% endfor %}
  </tbody>
  <tfoot>
    <tr><td colspan="2">Subtotal</td><td style="text-align:right;">{{ order.subtotal_minor | money(order.currency) }}</td></tr>
    <tr><td colspan="2">Shipping</td><td style="text-align:right;">{{ order.shipping_minor | money(order.currency) }}</td></tr>
    <tr><td colspan="2"><strong>Total paid</strong></td><td style="text-align:right;"><strong>{{ order.total_minor | money(order.currency) }}</strong></td></tr>
    {% if order.amount_refunded_minor %}
    <tr><td colspan="2">Refunded</td><td style="text-align:right;">-{{ order.amount_refunded_minor | money(order.currency) }}</td></tr>
    {% endif %}
  </tfoot>
</table>
<p><a href="{{ status_url }}">Track your order</a></p>
<p style="color:#777;font-size:12px;">Card details are handled entirely by our payment provider and are never stored by this store.</p>
</body></html>
"""
)

_REFUND_TEXT = _env.from_string(
    """{{ store_name }} — refund confirmation for order {{ order.reference }}

We have issued a refund of {{ refund_amount_minor | money(order.currency) }}
for order {{ order.reference }}.

Total refunded so far: {{ order.amount_refunded_minor | money(order.currency) }}
of {{ order.total_minor | money(order.currency) }}.

Refunds are returned to your original payment method. Depending on your bank,
it can take a few business days to appear on your statement.

Order details: {{ status_url }}
"""
)

_FAILED_TEXT = _env.from_string(
    """{{ store_name }} — we could not complete order {{ order.reference }}

Your payment for order {{ order.reference }} was not completed{% if reason %} ({{ reason }}){% endif %}.

Nothing has been charged, and the items have been returned to stock. You are
welcome to place the order again: {{ storefront_url }}
"""
)


def _fmt_time(value: dt.datetime | None) -> str:
    value = value or dt.datetime.now(tz=dt.UTC)
    return value.strftime("%d %b %Y, %H:%M UTC")


def render_paid_receipt(order, *, store_name: str, status_url: str) -> tuple[str, str, str]:
    ctx = {
        "order": order,
        "store_name": store_name,
        "status_url": status_url,
        "paid_at": _fmt_time(order.paid_at),
    }
    subject = f"{store_name}: receipt for order {order.reference}"
    return subject, _RECEIPT_TEXT.render(**ctx), _RECEIPT_HTML.render(**ctx)


def render_refund_receipt(
    order, *, refund_amount_minor: int, store_name: str, status_url: str
) -> tuple[str, str, None]:
    subject = f"{store_name}: refund for order {order.reference}"
    body = _REFUND_TEXT.render(
        order=order,
        store_name=store_name,
        status_url=status_url,
        refund_amount_minor=refund_amount_minor,
    )
    return subject, body, None


def render_payment_failed(
    order, *, store_name: str, storefront_url: str, reason: str | None
) -> tuple[str, str, None]:
    subject = f"{store_name}: order {order.reference} was not completed"
    body = _FAILED_TEXT.render(
        order=order, store_name=store_name, storefront_url=storefront_url, reason=reason
    )
    return subject, body, None
