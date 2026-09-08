"""Fixed-window rate limiting with a pluggable backend.

The in-memory backend is per-process, which is fine for a single replica or as
a coarse backstop. Set ``REDIS_URL`` to share counters across replicas — that
is the only correct choice once you run more than one web process behind a
load balancer.
"""

from __future__ import annotations

import logging
import time
from typing import Protocol, runtime_checkable

log = logging.getLogger(__name__)


@runtime_checkable
class RateLimitBackend(Protocol):
    async def incr(self, key: str, window_seconds: int) -> int: ...
    async def close(self) -> None: ...


class MemoryBackend:
    def __init__(self) -> None:
        self._counters: dict[tuple[str, int], int] = {}

    async def incr(self, key: str, window_seconds: int) -> int:
        bucket = int(time.time() // window_seconds)
        # Drop stale windows so a long-running process cannot grow unbounded.
        if len(self._counters) > 10_000:
            self._counters = {
                k: v for k, v in self._counters.items() if k[1] >= bucket - 1
            }
        composite = (key, bucket)
        self._counters[composite] = self._counters.get(composite, 0) + 1
        return self._counters[composite]

    async def close(self) -> None:
        self._counters.clear()


class RedisBackend:
    """Shared counters. Requires the ``redis`` package (already a dependency)."""

    def __init__(self, url: str) -> None:
        import redis.asyncio as redis

        self._redis = redis.from_url(url, encoding="utf-8", decode_responses=True)

    async def incr(self, key: str, window_seconds: int) -> int:
        bucket = int(time.time() // window_seconds)
        composite = f"rl:{key}:{bucket}"
        pipe = self._redis.pipeline()
        pipe.incr(composite)
        pipe.expire(composite, window_seconds + 1)
        count, _ = await pipe.execute()
        return int(count)

    async def close(self) -> None:
        await self._redis.aclose()


class RateLimiter:
    def __init__(self, backend: RateLimitBackend, *, enabled: bool = True) -> None:
        self._backend = backend
        self.enabled = enabled

    async def check(self, key: str, limit: int, window_seconds: int = 60) -> tuple[bool, int]:
        """Return ``(allowed, retry_after_seconds)``.

        A backend outage must not take checkout down, so a failure here fails
        open and is logged loudly rather than rejecting real customers.
        """
        if not self.enabled or limit <= 0:
            return True, 0
        try:
            count = await self._backend.incr(key, window_seconds)
        except Exception:
            log.exception("rate_limit_backend_error", extra={"key": key})
            return True, 0
        if count > limit:
            retry_after = window_seconds - int(time.time() % window_seconds)
            return False, max(retry_after, 1)
        return True, 0

    async def close(self) -> None:
        await self._backend.close()


def build_limiter(*, redis_url: str, enabled: bool) -> RateLimiter:
    if redis_url:
        try:
            return RateLimiter(RedisBackend(redis_url), enabled=enabled)
        except Exception:
            log.exception("rate_limit_redis_unavailable_falling_back_to_memory")
    return RateLimiter(MemoryBackend(), enabled=enabled)
