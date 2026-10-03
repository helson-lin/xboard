"""Background download pipeline: metadata -> media -> storage -> auto tagging."""
from __future__ import annotations

import shutil
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import db, downloader, tagger, storage
from .config import DATA_DIR, MEDIA_DIR, load_settings


class JobRunner:
    def __init__(self) -> None:
        self._executor: ThreadPoolExecutor | None = None
        self._lock = threading.Lock()
        self._futures: dict[str, object] = {}

    # ------------------------------------------------------------ lifecycle
    def executor(self) -> ThreadPoolExecutor:
        with self._lock:
            wanted = max(1, min(8, int(load_settings().get("concurrent_downloads") or 1)))
            if self._executor is None or self._executor._max_workers != wanted:  # type: ignore[attr-defined]
                if self._executor is not None:
                    self._executor.shutdown(wait=False)
                self._executor = ThreadPoolExecutor(
                    max_workers=wanted, thread_name_prefix="xboard-dl"
                )
            return self._executor

    def submit(self, url: str) -> str:
        job_id = uuid.uuid4().hex[:12]
        tweet_id = downloader.parse_tweet_id(url)
        db.create_job(job_id, url, tweet_id)
        future = self.executor().submit(self._run, job_id, url)
        self._futures[job_id] = future
        return job_id

    # ------------------------------------------------------------ pipeline
    def _run(self, job_id: str, url: str) -> None:
        settings = load_settings()
        db.update_job(job_id, status="running", stage="解析链接",
                      progress=0.02, started_at=db.now())
        try:
            tweet_id = downloader.parse_tweet_id(url)
            if not tweet_id:
                raise downloader.DownloadError(
                    "无法识别的链接，请使用 https://x.com/<用户>/status/<id> 形式"
                )
            db.update_job(job_id, post_id=tweet_id, stage="获取推文信息", progress=0.06)

            meta = downloader.fetch_tweet_meta(tweet_id)

            post = {
                "id": tweet_id,
                "url": f"https://x.com/i/status/{tweet_id}",
                "status": "downloading",
                "source": "syndication" if meta else "ytdlp",
                "author_name": None, "author_handle": None, "author_avatar": None,
                "author_verified": 0, "text": "", "lang": None, "created_at": None,
                "favorite_count": 0, "reply_count": 0, "media_kind": "text",
                "duration": None, "width": None, "height": None,
                "poster_path": None, "note": None, "error": None, "tagged_at": None,
            }
            if meta:
                post.update({
                    "url": meta["url"], "text": meta["text"], "lang": meta["lang"],
                    "created_at": meta["created_at"],
                    "favorite_count": meta["favorite_count"],
                    "reply_count": meta["reply_count"],
                    "author_name": meta["author_name"],
                    "author_handle": meta["author_handle"],
                    "author_avatar": meta["author_avatar"],
                    "author_verified": 1 if meta["author_verified"] else 0,
                    "duration": meta["duration"],
                })
            db.upsert_post(post)

            # Separate staging keeps retries from destroying archived local files.
            dest_dir = (MEDIA_DIR / ".staging" / tweet_id / uuid.uuid4().hex
                        if storage.enabled() else MEDIA_DIR / tweet_id)
            if dest_dir.exists():
                shutil.rmtree(dest_dir, ignore_errors=True)
            dest_dir.mkdir(parents=True, exist_ok=True)

            media_items: list[dict] = []
            errors: list[str] = []

            has_video = bool(meta and downloader.best_video_url(meta)[0])
            has_photos = bool(meta and downloader.image_urls(meta))

            # 1) video via yt-dlp
            if has_video or meta is None:
                def on_progress(fraction: float, stage: str) -> None:
                    db.update_job(job_id, progress=0.1 + fraction * 0.7, stage=stage)

                db.update_job(job_id, stage="下载视频", progress=0.1)
                try:
                    media_items.append(
                        downloader.download_video(
                            meta or {"url": f"https://x.com/i/status/{tweet_id}"},
                            dest_dir, settings, on_progress,
                        )
                    )
                except downloader.DownloadError as exc:
                    errors.append(str(exc))

            # 2) photos (also the fallback when a tweet has no video)
            if has_photos:
                db.update_job(job_id, stage="下载图片", progress=0.85)
                saved, failed = downloader.download_photos(meta, dest_dir)
                media_items.extend(saved)
                errors.extend(failed)

            # 3) poster for the card thumbnail
            if meta:
                poster = downloader.download_poster(meta, dest_dir)
                if poster:
                    post["poster_path"] = poster

            if not media_items and errors:
                raise downloader.DownloadError("; ".join(errors))
            if not media_items and not (meta and meta.get("text")):
                raise downloader.DownloadError("该推文没有可下载的媒体或文本")

            kind = "text"
            if any(m["kind"] == "video" for m in media_items):
                kind = "mixed" if any(
                    m["kind"] == "image" for m in media_items
                ) else "video"
            elif any(m["kind"] == "image" for m in media_items):
                kind = "image"
            post["media_kind"] = kind

            video = next((m for m in media_items if m["kind"] == "video"), None)
            if video:
                post["width"] = video.get("width")
                post["height"] = video.get("height")
                post["duration"] = video.get("duration") or post.get("duration")

            if storage.enabled():
                db.update_job(job_id, stage="上传媒体和头像到 R2", progress=0.90)
                storage.store_post_assets(post, media_items, dest_dir)
            db.replace_media(tweet_id, media_items)
            post["status"] = "ready"
            post["error"] = "; ".join(errors) if errors else None
            db.upsert_post(post)

            # 4) auto tagging
            if settings.get("auto_tag", True):
                db.update_job(job_id, stage="自动归类", progress=0.94)
                apply_auto_tags(tweet_id, settings)
                post["tagged_at"] = db.now()
                db.upsert_post(post)

            db.update_job(
                job_id, status="done", stage="完成", progress=1.0,
                message=f"{len(media_items)} 个媒体文件", finished_at=db.now(),
            )
            if storage.enabled():
                # Only remove this job's new staging directory, never history.
                if settings.get("keep_ytdlp_json"):
                    sidecars = list(dest_dir.glob("*.info.json"))
                    if sidecars:
                        archive = DATA_DIR / "metadata" / tweet_id / job_id
                        archive.mkdir(parents=True, exist_ok=True)
                        for sidecar in sidecars:
                            shutil.copy2(sidecar, archive / sidecar.name)
                shutil.rmtree(dest_dir, ignore_errors=True)
        except Exception as exc:  # noqa: BLE001
            detail = f"{exc}"
            db.update_job(job_id, status="failed", stage="失败", error=detail,
                          message=detail, finished_at=db.now())
            tweet_id = downloader.parse_tweet_id(url)
            if tweet_id:
                row = db.get_post(tweet_id)
                if row:
                    db.upsert_post({**dict(row), "status": "failed", "error": detail})
                else:
                    db.upsert_post({
                        "id": tweet_id, "url": url, "status": "failed", "error": detail,
                        "media_kind": "text", "added_at": db.now(),
                    })
            traceback.print_exc()
        finally:
            self._futures.pop(job_id, None)


def apply_auto_tags(post_id: str, settings: dict | None = None) -> list[str]:
    """(Re)compute rule based tags for a post and persist them."""
    settings = settings or load_settings()
    row = db.get_post(post_id)
    if not row:
        return []
    post = dict(row)
    media = db.get_media(post_id)
    for item in media:
        if item["kind"] == "video":
            post["duration"] = post.get("duration") or item["duration"]
            post["height"] = post.get("height") or item["height"]

    rules = tagger.load_rules()
    tags = tagger.auto_tag(post, rules, int(settings.get("max_auto_tags") or 6))
    db.set_post_tags(post_id, tags, source="auto", replace_source=True)
    for name, _score in tags:
        color = tagger.category_color(name, rules)
        if color:
            db.execute("UPDATE tags SET color=? WHERE name=? AND kind='auto'",
                       (color, name))
    db.execute("UPDATE posts SET tagged_at=? WHERE id=?", (db.now(), post_id))
    return [name for name, _ in tags]


runner = JobRunner()
