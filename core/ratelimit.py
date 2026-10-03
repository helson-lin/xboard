"""In-memory rate limiting and TTL caching for the public read surface.

The public homepage is anonymous, so it needs two protective layers that the
authenticated dashboard does not:

* A per-IP sliding-window limiter so a single client can't scrape the feed,
  hammer the media files, or repeatedly trigger expensive zip downloads.
* A small TTL cache so the public JSON endpoints don't re-query the DB on
  every request.

Both are process-local and intentionally cheap: entries are pruned on access
so the maps cannot grow without bound.
"""

from __future__ import annotations

import threading
import time
from typing import Any


class SlidingWindowLimiter:
    """Sliding-window request counter per key (usually a client IP)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, list[float]] = {}

    def _prune(self, key: str, now: float, window: float) -> list[float]:
        keep = [t for t in self._hits.get(key, []) if now - t < window]
        if keep:
            self._hits[key] = keep
        else:
            self._hits.pop(key, None)
        return keep

    def allow(self, key: str, limit: int, window: float) -> tuple[bool, int]:
        """Return ``(allowed, retry_after_seconds)``.

        A request is recorded only when allowed. Over-limit requests are *not*
        recorded, so a blocked client isn't rewarded with a longer block by
        continuing to hammer the endpoint.
        """
        now = time.time()
        with self._lock:
            hits = self._prune(key, now, window)
            if len(hits) >= limit:
                oldest = hits[0]
                retry = max(1, int(window - (now - oldest)) + 1)
                return False, retry
            self._hits.setdefault(key, []).append(now)
            return True, 0

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


class TTLCache:
    """Minimal thread-safe TTL cache with opportunistic pruning."""

    def __init__(self, max_entries: int = 4096) -> None:
        self._lock = threading.Lock()
        self._data: dict[str, tuple[float, Any]] = {}
        self._max_entries = max_entries

    def get(self, key: str) -> Any | None:
        now = time.time()
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            exp, value = item
            if exp <= now:
                self._data.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            self._data[key] = (time.time() + ttl, value)
            if len(self._data) > self._max_entries:
                now = time.time()
                self._data = {
                    k: v for k, v in self._data.items() if v[0] > now
                }

    def clear(self) -> None:
        with self._lock:
            self._data.clear()