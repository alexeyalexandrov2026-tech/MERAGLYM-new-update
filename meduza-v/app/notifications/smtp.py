"""SMTP channel — works with any provider that exposes SMTP submission
(Amazon SES, Postmark, SendGrid, Mailgun, Resend, or a self-hosted MTA).

PROVIDER-SPECIFIC CONFIGURATION REQUIRED: host, port, credentials, and a
verified sending domain with SPF/DKIM/DMARC records. See README.
"""

from __future__ import annotations

import logging
from email.message import EmailMessage

import aiosmtplib

from ..errors import ReceiptDeliveryError
from .base import Message

log = logging.getLogger(__name__)

#: SMTP 5xx replies are permanent; 4xx are transient and worth retrying.
_PERMANENT_PREFIXES = ("5",)


class SmtpChannel:
    name = "smtp"

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str = "",
        password: str = "",
        use_starttls: bool = True,
        from_address: str,
        from_name: str = "",
        timeout: int = 20,
    ) -> None:
        if not host:
            raise ValueError("SMTP host is required")
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._use_starttls = use_starttls
        self._from_address = from_address
        self._from_name = from_name
        self._timeout = timeout

    def _build(self, message: Message) -> EmailMessage:
        email = EmailMessage()
        email["From"] = (
            f"{self._from_name} <{self._from_address}>"
            if self._from_name
            else self._from_address
        )
        email["To"] = message.to
        email["Subject"] = message.subject
        email.set_content(message.body_text)
        if message.body_html:
            email.add_alternative(message.body_html, subtype="html")
        return email

    async def send(self, message: Message) -> None:
        try:
            await aiosmtplib.send(
                self._build(message),
                hostname=self._host,
                port=self._port,
                username=self._username or None,
                password=self._password or None,
                start_tls=self._use_starttls,
                timeout=self._timeout,
            )
        except aiosmtplib.SMTPRecipientsRefused as exc:
            raise ReceiptDeliveryError(
                f"recipient refused: {exc}", permanent=True
            ) from exc
        except aiosmtplib.SMTPResponseException as exc:
            permanent = str(exc.code).startswith(_PERMANENT_PREFIXES)
            raise ReceiptDeliveryError(
                f"smtp {exc.code}: {exc.message}", permanent=permanent
            ) from exc
        except (aiosmtplib.SMTPException, OSError, TimeoutError) as exc:
            raise ReceiptDeliveryError(f"smtp transport error: {exc}") from exc
