"""Notification channel factory."""

from __future__ import annotations

from functools import lru_cache

from ..config import Settings, get_settings
from .base import Message, NotificationChannel

__all__ = ["Message", "NotificationChannel", "build_channel", "get_channel"]


def build_channel(settings: Settings) -> NotificationChannel:
    if settings.email_backend == "smtp":
        from .smtp import SmtpChannel

        return SmtpChannel(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            use_starttls=settings.smtp_starttls,
            from_address=settings.email_from,
            from_name=settings.email_from_name,
            timeout=settings.smtp_timeout_seconds,
        )
    if settings.email_backend == "memory":
        from .console import MemoryChannel

        return MemoryChannel()
    from .console import ConsoleChannel

    return ConsoleChannel()


@lru_cache(maxsize=1)
def get_channel() -> NotificationChannel:
    return build_channel(get_settings())
