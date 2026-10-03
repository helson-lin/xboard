"""Tweet metadata + media fetching.

Two sources are combined:

* the public syndication endpoint (``cdn.syndication.twimg.com``) gives tweet
  text, author, stats, photo list and video variants without authentication --
  this also covers text-only and image-only tweets that yt-dlp cannot handle;
* yt-dlp does the actual video download (with ffmpeg merging), as requested.
"""
from __future__ import annotations

import json
import hashlib
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .config import MEDIA_DIR, USER_AGENT

TWEET_ID_RE = re.compile(
    r"https://(?:www\.)?(?:twitter\.com|x\.com)/[^/?#]+/status(?:es)?/(\d+)(?:[/?#].*)?$"
)
SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result?id={tid}&token=a"

# X Premium "Note" (long-form) tweets are truncated to ~280 chars on the
# syndication endpoint; the full body lives in ``note_tweet``. We fetch it via
# the anonymous GraphQL endpoint (guest token), same technique yt-dlp uses.
GRAPHQL_BEARER = (
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
    "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)
GRAPHQL_FEATURES = {
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "tweetypie_unmention_optimization_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": False,
    "tweet_awards_web_tipping_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "responsive_web_media_download_video_enabled": False,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
}

VIDEO_EXT_BY_MIME = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}


class DownloadError(RuntimeError):
    pass


def download_avatar(url: str) -> Path:
    """Cache X avatars by URL; reject redirects outside X's image CDN."""
    def validate(value):
        parsed = urllib.parse.urlsplit(value)
        host = (parsed.hostname or "").lower()
        if (parsed.scheme != "https" or parsed.username or parsed.password
                or parsed.port not in (None, 443)
                or not (host == "twimg.com" or host.endswith(".twimg.com"))):
            raise DownloadError("作者头像地址必须来自 HTTPS twimg.com")
    validate(url)
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            validate(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    directory = MEDIA_DIR / "avatars"
    directory.mkdir(parents=True, exist_ok=True)
    stem = hashlib.sha256(url.encode()).hexdigest()
    for ext in (".jpg", ".png", ".webp", ".gif"):
        cached = directory / (stem + ext)
        if cached.is_file() and cached.stat().st_size:
            return cached
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.build_opener(Redirect()).open(req, timeout=30) as resp:
        mime = resp.headers.get_content_type()
        ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(mime)
        data = resp.read(5 * 1024 * 1024 + 1)
        if not ext or not data or len(data) > 5 * 1024 * 1024:
            raise DownloadError("头像不是支持的图片，或超过 5 MB")
    import tempfile
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as tmp:
        tmp.write(data)
        temporary = Path(tmp.name)
    target = directory / (stem + ext)
    temporary.replace(target)
    return target


def parse_tweet_id(url: str) -> str | None:
    if not url:
        return None
    url = url.strip()
    if url.isdigit():
        return url
    # Full-match only: reject any URL that merely *contains* an x.com/twitter.com
    # status path (this was the SSRF vector — a host like 127.0.0.1/.../x.com/
    # status/1 used to pass and then get handed to yt-dlp as-is).
    match = TWEET_ID_RE.match(url)
    if match:
        return match.group(1)
    return None


def _http_get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json,image/*,*/*",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _fetch_note_full_text(tweet_id: str) -> str | None:
    """Fetch the full body of an X Premium long-form (Note) tweet.

    The syndication endpoint truncates Note tweets at ~280 chars and only
    exposes the note id. The anonymous GraphQL endpoint returns the complete
    text under ``note_tweet.note_tweet_results.result.text``. Returns None on
    any failure so callers can safely fall back to the truncated text.
    """
    try:
        # 1. anonymous guest token
        req = urllib.request.Request(
            "https://api.twitter.com/1.1/guest/activate.json",
            method="POST",
            headers={
                "User-Agent": USER_AGENT,
                "Authorization": f"Bearer {GRAPHQL_BEARER}",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            guest_token = json.loads(resp.read()).get("guest_token")
        if not guest_token:
            return None

        # 2. TweetResultByRestId query (same id yt-dlp uses)
        variables = {
            "tweetId": tweet_id,
            "withCommunity": False,
            "includePromotedContent": False,
            "withVoice": False,
        }
        params = urllib.parse.urlencode({
            "variables": json.dumps(variables, separators=(",", ":")),
            "features": json.dumps(GRAPHQL_FEATURES, separators=(",", ":")),
        })
        url = (
            "https://x.com/i/api/graphql/2ICDjqPd81tulZcYrtpTuQ"
            f"/TweetResultByRestId?{params}"
        )
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Authorization": f"Bearer {GRAPHQL_BEARER}",
                "x-guest-token": guest_token,
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read())

        result = (payload.get("data") or {}).get("tweetResult", {}).get("result") or {}
        note = result.get("note_tweet") or {}
        note_result = (note.get("note_tweet_results") or {}).get("result") or {}
        text = note_result.get("text")
        return text or None
    except Exception:  # noqa: BLE001 - fall back to truncated text
        return None


def fetch_tweet_meta(tweet_id: str) -> dict | None:
    """Return normalised tweet metadata, or None when unavailable."""
    try:
        raw = _http_get(SYNDICATION_URL.format(tid=tweet_id))
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 403, 404):
            # tweet deleted, protected, or id malformed -> let yt-dlp try instead
            return None
        raise DownloadError(f"推文元数据请求失败: HTTP {exc.code}") from exc
    except Exception as exc:  # noqa: BLE001
        raise DownloadError(f"推文元数据请求失败: {exc}") from exc

    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not data or not data.get("text") and not data.get("user"):
        return None

    user = data.get("user") or {}
    video = data.get("video") or {}
    photos = data.get("photos") or []

    # mediaDetails is richer: it lists every attachment in order.
    details = []
    for item in data.get("mediaDetails") or []:
        if item.get("type") == "photo" and item.get("media_url_https"):
            details.append({
                "kind": "image",
                "url": item["media_url_https"],
                "width": item.get("original_info", {}).get("width"),
                "height": item.get("original_info", {}).get("height"),
            })
        elif item.get("type") in ("video", "animated_gif"):
            variants = ((item.get("video_info") or {}).get("variants") or [])
            mp4s = [v for v in variants if v.get("content_type") == "video/mp4"]
            if mp4s:
                best = sorted(mp4s, key=lambda v: v.get("bitrate", 0))[-1]
                details.append({
                    "kind": "video",
                    "url": best["url"],
                    "poster": item.get("media_url_https"),
                    "duration_ms": (item.get("video_info") or {}).get("duration_millis"),
                    "aspect": item.get("original_info"),
                })

    if not details:
        for photo in photos:
            if photo.get("url"):
                details.append({"kind": "image", "url": photo["url"]})
        if video:
            details.append({
                "kind": "video",
                "poster": video.get("poster"),
                "duration_ms": video.get("durationMs"),
                "variants": video.get("variants") or [],
            })

    duration = None
    if video.get("durationMs"):
        duration = round(video["durationMs"] / 1000, 2)
    poster = video.get("poster")

    text = data.get("text") or ""
    # Long-form (Note) tweets: syndication truncates the body; fetch full text.
    if data.get("note_tweet"):
        full = _fetch_note_full_text(tweet_id)
        if full:
            text = full

    return {
        "id": tweet_id,
        "url": f"https://x.com/i/status/{tweet_id}",
        "text": text,
        "lang": data.get("lang"),
        "created_at": data.get("created_at"),
        "favorite_count": data.get("favorite_count") or 0,
        "reply_count": data.get("conversation_count") or 0,
        "author_name": user.get("name"),
        "author_handle": user.get("screen_name"),
        "author_avatar": user.get("profile_image_url_https"),
        "author_verified": bool(user.get("is_blue_verified")),
        "duration": duration,
        "poster_url": poster,
        "media": details,
    }


def fetch_to_file(url: str, dest: Path, timeout: int = 90) -> int:
    """Stream a URL to disk; returns bytes written."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp, dest.open("wb") as fh:
        total = 0
        while True:
            chunk = resp.read(1 << 16)
            if not chunk:
                break
            fh.write(chunk)
            total += len(chunk)
    return total


def best_video_url(meta: dict) -> tuple[str | None, str | None]:
    """Pick the highest-bitrate mp4 plus a poster URL from syndication data."""
    poster = meta.get("poster_url")
    for item in meta.get("media") or []:
        if item.get("kind") == "video":
            if item.get("poster") and not poster:
                poster = item["poster"]
            if item.get("url"):
                return item["url"], poster
            variants = item.get("variants") or []
            mp4s = [v for v in variants if v.get("type") == "video/mp4"]
            if mp4s:
                return mp4s[-1]["src"], poster
    return None, poster


def image_urls(meta: dict) -> list[dict]:
    out = []
    for item in meta.get("media") or []:
        if item.get("kind") == "image" and item.get("url"):
            out.append(item)
    return out


def download_video(meta: dict, dest_dir: Path, settings: dict,
                   progress_cb=None) -> dict:
    """Download the tweet video with yt-dlp. Raises DownloadError on failure."""
    from yt_dlp import YoutubeDL

    dest_dir.mkdir(parents=True, exist_ok=True)
    url = meta["url"]
    max_height = int(settings.get("max_height") or 1080)

    def hook(status: dict) -> None:
        if not progress_cb:
            return
        if status.get("status") == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate")
            done = status.get("downloaded_bytes") or 0
            if total:
                progress_cb(min(done / total, 1.0), "下载视频")
            else:
                progress_cb(0.0, "下载视频")
        elif status.get("status") == "finished":
            progress_cb(1.0, "转码 / 合并")

    fmt = (
        f"bestvideo[height<=?{max_height}]+bestaudio/"
        f"best[height<=?{max_height}]/best"
    )
    opts = {
        "outtmpl": str(dest_dir / "video.%(ext)s"),
        "format": fmt,
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "retries": 3,
        "fragment_retries": 3,
        "progress_hooks": [hook],
        "writethumbnail": False,
        "writeinfojson": bool(settings.get("keep_ytdlp_json")),
        "overwrites": True,
    }
    from .config import ytdlp_cookie_arg
    opts.update(ytdlp_cookie_arg())

    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as exc:  # noqa: BLE001
        raise DownloadError(f"yt-dlp 下载失败: {exc}") from exc

    if not info:
        raise DownloadError("yt-dlp 未返回任何媒体信息")

    path = None
    requested = info.get("requested_downloads") or []
    if requested and requested[0].get("filepath"):
        path = Path(requested[0]["filepath"])
    if path is None or not path.exists():
        try:
            path = Path(info.get("_filename") or "")
        except Exception:  # noqa: BLE001
            path = None
    if path is None or not path.exists():
        candidates = sorted(
            p for p in dest_dir.glob("video.*")
            if p.suffix.lower() not in (".json", ".jpg", ".webp")
        )
        path = candidates[0] if candidates else None
    if path is None or not path.exists():
        raise DownloadError("下载完成但未找到媒体文件")

    return {
        "kind": "video",
        "path": str(path.relative_to(MEDIA_DIR)),
        "mime": "video/mp4" if path.suffix.lower() == ".mp4" else "video/*",
        "width": info.get("width"),
        "height": info.get("height"),
        "duration": info.get("duration") or meta.get("duration"),
        "filesize": path.stat().st_size,
        "ytdlp_id": info.get("id"),
        "extractor": info.get("extractor"),
    }


def download_photos(meta: dict, dest_dir: Path, limit: int = 8) -> tuple[list[dict], list[str]]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict] = []
    failed: list[str] = []
    for idx, item in enumerate(image_urls(meta)[:limit]):
        src = item["url"]
        url_path = src.split("?")[0]
        ext = Path(url_path).suffix.lower()
        # pbs.twimg.com images can be requested at full size. PNG sources do not
        # respond to ?format=jpg (CDN returns 404), so keep their original format.
        if "pbs.twimg.com" in src:
            if ext == ".png":
                src = url_path + "?name=orig"
            else:
                src = url_path + "?format=jpg&name=orig"
                ext = ".jpg"
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            ext = ".jpg"
        dest = dest_dir / f"image_{idx + 1}{ext}"
        try:
            size = fetch_to_file(src, dest)
        except Exception:  # noqa: BLE001
            if dest.exists():
                dest.unlink()
            failed.append(f"第 {idx + 1} 张图片下载失败")
            continue
        saved.append({
            "kind": "image",
            "path": str(dest.relative_to(MEDIA_DIR)),
            "mime": "image/png" if ext == ".png" else "image/jpeg",
            "width": item.get("width"),
            "height": item.get("height"),
            "filesize": size,
            "position": idx,
        })
    return saved, failed


def download_poster(meta: dict, dest_dir: Path) -> str | None:
    poster = meta.get("poster_url")
    if not poster:
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "poster.jpg"
    try:
        fetch_to_file(poster, dest)
    except Exception:  # noqa: BLE001
        return None
    return str(dest.relative_to(MEDIA_DIR))
