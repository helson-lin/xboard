"""Central paths and runtime configuration for XBoard."""
from __future__ import annotations

import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("XBOARD_DATA_DIR", BASE_DIR / "data"))
CONFIG_DIR = Path(os.environ.get("XBOARD_CONFIG_DIR", BASE_DIR / "config"))
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = DATA_DIR / "xboard.db"
TAG_RULES_PATH = CONFIG_DIR / "tag_rules.json"
SETTINGS_PATH = CONFIG_DIR / "settings.json"
COOKIES_PATH = CONFIG_DIR / "cookies.txt"
STATIC_DIR = BASE_DIR / "static"

for _d in (DATA_DIR, CONFIG_DIR, MEDIA_DIR):
    _d.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS = {
    # yt-dlp
    "max_height": 1080,          # cap video resolution
    "concurrent_downloads": 2,
    "write_thumbnail": True,
    "keep_ytdlp_json": True,
    # tagging
    "auto_tag": True,
    "max_auto_tags": 6,
    # optional LLM re-tagging (OpenAI-compatible). Empty base_url disables it.
    "llm_base_url": "",
    "llm_api_key": "",
    "llm_model": "",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def load_settings() -> dict:
    settings = dict(DEFAULT_SETTINGS)
    if SETTINGS_PATH.exists():
        try:
            settings.update(json.loads(SETTINGS_PATH.read_text("utf-8")))
        except Exception:
            pass
    return settings


def save_settings(settings: dict) -> dict:
    merged = load_settings()
    merged.update({k: v for k, v in settings.items() if k in DEFAULT_SETTINGS})
    SETTINGS_PATH.write_text(json.dumps(merged, indent=2, ensure_ascii=False), "utf-8")
    # settings.json may hold the LLM API key in plaintext — keep it private.
    try:
        os.chmod(SETTINGS_PATH, 0o600)
    except OSError:
        pass
    return merged


def ytdlp_cookie_arg() -> dict:
    """Cookie file for yt-dlp when the user dropped one in config/."""
    if COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 0:
        return {"cookiefile": str(COOKIES_PATH)}
    return {}
