"""Authentication for XBoard.

Username/password login backed by stateless, HMAC-signed session cookies, plus
an in-memory login rate limiter to blunt brute-force attempts.

Security notes
--------------
* Passwords are hashed with PBKDF2-HMAC-SHA256 (stdlib only) using a random
  per-install salt and a high iteration count. No plaintext is ever stored.
* Sessions are stateless: the cookie is ``base64url(payload).hmac_hex`` where
  the HMAC is keyed by a per-install secret stored in ``config/secret.key``.
  This survives process restarts without a server-side session table.
* Credentials live in ``config/auth.json`` (username + salt + iterations +
  hash). ``XBOARD_USERNAME`` / ``XBOARD_PASSWORD`` env vars take precedence
  and are never persisted.
* On first run (no env password and no auth.json) a random password is
  generated and written to auth.json; the plaintext is surfaced once via
  ``AuthManager.generated_password`` so the operator can read it from the log.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time

from .config import CONFIG_DIR

AUTH_FILE = CONFIG_DIR / "auth.json"
SECRET_FILE = CONFIG_DIR / "secret.key"

COOKIE_NAME = "xboard_session"
TOKEN_TTL = 7 * 24 * 3600  # 7 days
DEFAULT_USERNAME = "admin"
PBKDF2_ITERATIONS = 260_000


def _hash_password(password: str, salt: str, iterations: int) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations
    ).hex()


def _new_salt() -> str:
    return secrets.token_hex(16)


def _generate_password() -> str:
    # ~16 characters, URL-safe, no ambiguous characters.
    return secrets.token_urlsafe(12)


class AuthManager:
    """Holds credentials and verifies login attempts."""

    def __init__(self) -> None:
        self.username = DEFAULT_USERNAME
        self._salt = _new_salt()
        self._iterations = PBKDF2_ITERATIONS
        self._hash = ""
        self.generated_password: str | None = None

    def configure(self) -> None:
        env_user = os.environ.get("XBOARD_USERNAME")
        env_pass = os.environ.get("XBOARD_PASSWORD")
        if env_pass:
            self.username = env_user or DEFAULT_USERNAME
            self._salt = _new_salt()
            self._iterations = PBKDF2_ITERATIONS
            self._hash = _hash_password(env_pass, self._salt, self._iterations)
            return

        if AUTH_FILE.exists():
            try:
                data = json.loads(AUTH_FILE.read_text("utf-8"))
                self.username = data.get("username") or DEFAULT_USERNAME
                self._salt = data["salt"]
                self._iterations = int(data.get("iterations", PBKDF2_ITERATIONS))
                self._hash = data["hash"]
                if self._salt and self._hash:
                    return
            except Exception:
                pass  # fall through and (re)create below

        password = _generate_password()
        self.username = DEFAULT_USERNAME
        self._salt = _new_salt()
        self._iterations = PBKDF2_ITERATIONS
        self._hash = _hash_password(password, self._salt, self._iterations)
        self.generated_password = password
        AUTH_FILE.write_text(
            json.dumps(
                {
                    "username": self.username,
                    "salt": self._salt,
                    "iterations": self._iterations,
                    "hash": self._hash,
                },
                indent=2,
            ),
            "utf-8",
        )
        try:
            os.chmod(AUTH_FILE, 0o600)
        except OSError:
            pass

    def verify(self, username: str, password: str) -> bool:
        # Always run the KDF so the timing is independent of whether the
        # username matches (prevents username enumeration via timing).
        candidate = _hash_password(password, self._salt, self._iterations)
        user_ok = hmac.compare_digest(
            username.encode("utf-8"), self.username.encode("utf-8")
        )
        pass_ok = hmac.compare_digest(candidate, self._hash)
        return user_ok and pass_ok


# --------------------------------------------------------------------------
# Session tokens (stateless, HMAC-signed)
# --------------------------------------------------------------------------

_SECRET: bytes | None = None


def _secret() -> bytes:
    global _SECRET
    if _SECRET is None:
        if SECRET_FILE.exists():
            try:
                _SECRET = bytes.fromhex(SECRET_FILE.read_text("utf-8").strip())
                if _SECRET:
                    return _SECRET
            except Exception:
                _SECRET = None
        _SECRET = secrets.token_bytes(32)
        SECRET_FILE.write_text(_SECRET.hex(), "utf-8")
        try:
            os.chmod(SECRET_FILE, 0o600)
        except OSError:
            pass
    return _SECRET


def _sign(payload: bytes) -> str:
    return hmac.new(_secret(), payload, hashlib.sha256).hexdigest()


def create_token(username: str) -> str:
    payload = f"{username}:{int(time.time())}".encode("utf-8")
    body = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return f"{body}.{_sign(payload)}"


def verify_token(token: str | None) -> str | None:
    """Return the username if the token is valid and unexpired, else None."""
    if not token:
        return None
    try:
        body, sig = token.rsplit(".", 1)
        payload = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        if not hmac.compare_digest(sig, _sign(payload)):
            return None
        text = payload.decode("utf-8")
        username, ts = text.rsplit(":", 1)
        if time.time() - int(ts) > TOKEN_TTL:
            return None
        return username
    except Exception:
        return None


# --------------------------------------------------------------------------
# API tokens (long-lived static bearer tokens for automation / extensions)
# --------------------------------------------------------------------------

API_TOKEN_FILE = CONFIG_DIR / "api_token.json"
API_TOKEN_PREFIX = "xb_"

_api_token: str | None = None
_generated_api_token: str | None = None


def _new_api_token() -> str:
    return API_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _write_api_token(token: str) -> None:
    API_TOKEN_FILE.write_text(json.dumps({"token": token}, indent=2), "utf-8")
    try:
        os.chmod(API_TOKEN_FILE, 0o600)
    except OSError:
        pass


def get_api_token() -> str:
    """Return the persistent API token, creating it on first use.

    Resolution order: ``XBOARD_API_TOKEN`` env var, then the persisted file,
    then a freshly generated value written to the file. The generated value
    is surfaced once via :func:`take_generated_api_token`.
    """
    global _api_token, _generated_api_token
    if _api_token is not None:
        return _api_token

    env = os.environ.get("XBOARD_API_TOKEN")
    if env:
        _api_token = env
        return _api_token

    if API_TOKEN_FILE.exists():
        try:
            token = json.loads(API_TOKEN_FILE.read_text("utf-8")).get("token")
            if token:
                _api_token = token
                return _api_token
        except Exception:
            pass

    token = _new_api_token()
    _api_token = token
    _generated_api_token = token
    _write_api_token(token)
    return _api_token


def take_generated_api_token() -> str | None:
    """Pop and return the token that was auto-generated this boot, if any."""
    global _generated_api_token
    token = _generated_api_token
    _generated_api_token = None
    return token


def verify_api_token(token: str | None) -> bool:
    """Constant-time check of a supplied bearer token."""
    if not token:
        return False
    return hmac.compare_digest(token.encode("utf-8"), get_api_token().encode("utf-8"))


def rotate_api_token() -> str:
    """Generate and persist a fresh API token, invalidating the old one."""
    global _api_token
    token = _new_api_token()
    _api_token = token
    _write_api_token(token)
    return token


# --------------------------------------------------------------------------
# Login rate limiter (brute-force protection)
# --------------------------------------------------------------------------

class LoginLimiter:
    """Sliding-window failure counter + hard lockout, per key.

    Two key namespaces are tracked:

    * ``ip:<ip>``  — locks a source IP after repeated failures.
    * ``user:<u>`` — locks a username across all IPs (thwarts distributed
      attempts against a single account).
    """

    def __init__(
        self,
        max_attempts: int = 5,
        window: int = 900,
        lock_seconds: int = 900,
    ) -> None:
        self.max_attempts = max_attempts
        self.window = window
        self.lock_seconds = lock_seconds
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}
        self._blocked_until: dict[str, float] = {}

    def _within(self, key: str, now: float) -> list[float]:
        return [t for t in self._failures.get(key, []) if now - t < self.window]

    def _prune(self, now: float) -> None:
        """Drop expired entries so the in-memory maps cannot grow without bound."""
        self._blocked_until = {
            k: v for k, v in self._blocked_until.items() if v > now
        }
        for k in list(self._failures):
            kept = [t for t in self._failures[k] if now - t < self.window]
            if kept:
                self._failures[k] = kept
            else:
                del self._failures[k]

    def blocked_for(self, key: str) -> int:
        """Seconds the key must still wait, or 0 if not currently blocked."""
        now = time.time()
        with self._lock:
            self._prune(now)
            until = self._blocked_until.get(key, 0.0)
            if until > now:
                return int(until - now) + 1
            failures = self._within(key, now)
            if failures:
                self._failures[key] = failures
            if len(failures) >= self.max_attempts:
                self._blocked_until[key] = now + self.lock_seconds
                return self.lock_seconds
            return 0

    def record_failure(self, key: str) -> None:
        now = time.time()
        with self._lock:
            self._failures.setdefault(key, []).append(now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
            self._blocked_until.pop(key, None)


auth = AuthManager()
limiter = LoginLimiter()
