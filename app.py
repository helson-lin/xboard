"""XBoard - FastAPI application."""
from __future__ import annotations

import io
import shutil
import zipfile
import tempfile
from pathlib import Path
from urllib.parse import quote

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from core import db, downloader, jobs, tagger, storage
from core.ratelimit import SlidingWindowLimiter, TTLCache
from core.auth import (COOKIE_NAME, TOKEN_TTL, auth as auth_manager, create_token,
                       get_api_token, limiter, rotate_api_token,
                       take_generated_api_token, verify_api_token, verify_token)
from core.config import (COOKIES_PATH, MEDIA_DIR, STATIC_DIR, load_settings,
                         save_settings)

app = FastAPI(
    title="XBoard",
    version="1.0.0",
    # Docs expose the full API schema (internal endpoints, settings, rules) on
    # the public internet, so disable them in production.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
db.init_db()

auth_manager.configure()
if auth_manager.generated_password:
    print(
        "[xboard] 首次启动，已生成登录凭据：\n"
        f"        用户名: {auth_manager.username}\n"
        f"        密码:   {auth_manager.generated_password}\n"
        "        (已保存到 config/auth.json，可用 XBOARD_USERNAME / "
        "XBOARD_PASSWORD 环境变量覆盖)",
        flush=True,
    )

# Long-lived API token for automation (Chrome extension, scripts). CORS is
# enabled below so the extension can POST cross-origin with the Bearer token.
get_api_token()
if take_generated_api_token():
    print(
        "[xboard] 已生成 API Token（用于插件/脚本调用，Bearer 认证）：\n"
        f"        {get_api_token()}\n"
        "        (已保存到 config/api_token.json，可用 XBOARD_API_TOKEN "
        "环境变量覆盖；可用 /api/auth/token 查看或轮换)",
        flush=True,
    )

# The web app is same-origin (cookie auth). The Chrome extension calls from
# x.com and uses a Bearer token (no credentials), so a wildcard origin is safe.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    # Re-run anything that was mid-flight when the process stopped.
    if db.requeue_stale_jobs():
        for job in db.query("SELECT id, url FROM jobs WHERE status='queued'"):
            jobs.runner.submit(job["url"])


# ---------------------------------------------------------------- serialisation

def media_url(path: str | None) -> str | None:
    return storage.url(path)


def post_payload(row, media_rows=None, tags=None) -> dict:
    post = dict(row)
    media_rows = media_rows if media_rows is not None else db.get_media(post["id"])
    tags = tags if tags is not None else db.post_tag_names(post["id"])
    items = []
    for m in media_rows:
        m = dict(m)
        m["url"] = media_url(m["path"])
        items.append(m)
    videos = [m for m in items if m["kind"] == "video"]
    images = [m for m in items if m["kind"] == "image"]
    return {
        **post,
        "author_avatar": storage.url(post.get("author_avatar")),
        "poster_url": media_url(post.get("poster_path")),
        "tags": tags,
        "media": items,
        "videos": videos,
        "images": images,
        "has_video": bool(videos),
        "size_bytes": sum(m.get("filesize") or 0 for m in items),
    }


# ---------------------------------------------------------------- static

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")


@app.get("/")
def public_index():
    return FileResponse(str(STATIC_DIR / "public.html"))


@app.get("/admin")
def admin_index():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/healthz")
def healthz():
    # Liveness probe only — do not leak internal metrics (e.g. post count).
    return {"ok": True}


# ---------------------------------------------------------------- auth

# Anonymous public surface protection: per-IP sliding-window rate limits
# (keyed on the Cloudflare client IP) and a short TTL cache for the read-only
# JSON endpoints, so scrapers can't hammer the feed or re-query the DB non-stop.
PUBLIC_LIMITER = SlidingWindowLimiter()
PUBLIC_CACHE = TTLCache()


def _public_rate_limit(path: str) -> tuple[int, float]:
    """Return ``(request_limit, window_seconds)`` for an anonymous request."""
    if path.endswith("/download"):
        return 10, 60.0   # zip packaging is the most expensive path
    if path.startswith("/media/"):
        return 600, 60.0  # media files: one page can load many images
    return 120, 60.0      # public JSON list/detail/tags


def _client_ip(request: Request) -> str:
    # Cloudflare sets CF-Connecting-IP to the true client; the client cannot
    # spoof it (Cloudflare overwrites the header before proxying).
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    peer = request.client.host if request.client else ""
    # Only trust X-Forwarded-For when the direct peer is a trusted local proxy
    # (e.g. cloudflared/uvicorn on the same host). A direct internet client can
    # forge X-Forwarded-For, so ignore it in that case.
    if peer in ("127.0.0.1", "::1", "localhost"):
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    return peer or "unknown"


def _is_https(request: Request) -> bool:
    """True when the request arrived over TLS (directly or via a TLS proxy)."""
    if request.url.scheme == "https":
        return True
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return proto == "https"


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # CORS preflight (OPTIONS) carries no credentials and must be answered by
    # CORSMiddleware, not rejected here — otherwise browser extensions can't
    # even attempt the cross-origin POST that carries the Bearer token.
    if request.method == "OPTIONS":
        return await call_next(request)
    if path in ("/api/auth/login", "/api/auth/logout", "/api/auth/me"):
        return await call_next(request)
    # Public read-only surface: anonymous visitors may browse ready posts and
    # view media files (GET/HEAD only). Rate-limit by client IP and stamp the
    # responses with cache headers so browsers/CDN don't re-fetch everything.
    if (path.startswith("/public/") or path.startswith("/media/")) and request.method in ("GET", "HEAD"):
        limit, window = _public_rate_limit(path)
        allowed, retry = PUBLIC_LIMITER.allow(_client_ip(request), limit, window)
        if not allowed:
            return JSONResponse(
                {"detail": "请求过于频繁，请稍后再试"},
                status_code=429,
                headers={"Retry-After": str(retry)},
            )
        response = await call_next(request)
        if path.startswith("/media/"):
            response.headers["Cache-Control"] = "public, max-age=86400"
        elif path.endswith("/download"):
            response.headers["Cache-Control"] = "no-store"
        else:
            response.headers["Cache-Control"] = "public, max-age=15"
        return response
    if path.startswith("/api/"):
        authed = verify_token(request.cookies.get(COOKIE_NAME)) is not None
        if not authed:
            authed = verify_api_token(_bearer_token(request))
        if not authed:
            return JSONResponse({"detail": "未登录或会话已过期"}, status_code=401)
    return await call_next(request)


@app.post("/api/auth/login")
def login(payload: dict = Body(...), request: Request = None):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    ip = _client_ip(request)

    ip_key = f"ip:{ip}"
    user_key = f"user:{username}" if username else ip_key
    wait = max(limiter.blocked_for(ip_key), limiter.blocked_for(user_key))
    if wait:
        return JSONResponse(
            {"detail": f"尝试次数过多，请 {wait} 秒后再试"},
            status_code=429,
            headers={"Retry-After": str(wait)},
        )

    if not auth_manager.verify(username, password):
        limiter.record_failure(ip_key)
        if username:
            limiter.record_failure(user_key)
        return JSONResponse({"detail": "用户名或密码错误"}, status_code=401)

    limiter.clear(ip_key)
    limiter.clear(user_key)
    resp = JSONResponse({"username": auth_manager.username})
    resp.set_cookie(
        COOKIE_NAME,
        create_token(username),
        max_age=TOKEN_TTL,
        httponly=True,
        samesite="lax",
        secure=_is_https(request),
        path="/",
    )
    return resp


@app.post("/api/auth/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME, path="/")
    return resp


@app.get("/api/auth/me")
def me(request: Request):
    username = verify_token(request.cookies.get(COOKIE_NAME))
    if username is None:
        if verify_api_token(_bearer_token(request)):
            return {"authenticated": True, "username": "api"}
        return JSONResponse({"authenticated": False}, status_code=401)
    return {"authenticated": True, "username": username}


@app.get("/api/auth/token")
def view_api_token(request: Request):
    """View the API token (requires a logged-in browser session)."""
    if verify_token(request.cookies.get(COOKIE_NAME)) is None:
        return JSONResponse({"detail": "需要登录"}, status_code=401)
    return {"token": get_api_token()}


@app.post("/api/auth/token/rotate")
def rotate_api_token_endpoint(request: Request):
    """Rotate the API token (requires a logged-in browser session)."""
    if verify_token(request.cookies.get(COOKIE_NAME)) is None:
        return JSONResponse({"detail": "需要登录"}, status_code=401)
    return {"token": rotate_api_token()}


# ---------------------------------------------------------------- downloads

@app.post("/api/download")
def create_download(payload: dict = Body(...)):
    raw = payload.get("urls") or payload.get("url") or ""
    if isinstance(raw, list):
        urls = raw
    else:
        urls = [line for line in str(raw).replace(",", "\n").splitlines()]
    urls = [u.strip() for u in urls if u and u.strip()]
    if not urls:
        raise HTTPException(400, "请提供至少一个推文链接")

    accepted, rejected = [], []
    for url in urls:
        if downloader.parse_tweet_id(url):
            accepted.append(jobs.runner.submit(url))
        else:
            rejected.append(url)
    return {"queued": len(accepted), "job_ids": accepted, "rejected": rejected}


@app.get("/api/jobs")
def list_jobs(limit: int = Query(30, ge=1, le=200)):
    return {"items": db.list_jobs(limit)}


@app.post("/api/jobs/{job_id}/retry")
def retry_job(job_id: str):
    row = db.get_job(job_id)
    if not row:
        raise HTTPException(404, "任务不存在")
    new_id = jobs.runner.submit(row["url"])
    return {"job_id": new_id}


# ---------------------------------------------------------------- posts

def _query_posts(
    tag=None,
    q=None,
    kind=None,
    author=None,
    sort="new",
    limit=60,
    offset=0,
    only_ready=False,
):
    where, params = [], []
    if only_ready:
        where.append("p.status = 'ready'")
    if tag == "__untagged__":
        where.append("p.id NOT IN (SELECT post_id FROM post_tags)")
    elif tag:
        where.append(
            "p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id=pt.tag_id"
            " WHERE t.name=?)"
        )
        params.append(tag)
    if q:
        where.append(
            "(LOWER(p.text) LIKE ? OR LOWER(p.author_handle) LIKE ?"
            " OR LOWER(p.author_name) LIKE ? OR p.id LIKE ?)"
        )
        needle = f"%{q.lower()}%"
        params += [needle, needle, needle, f"%{q}%"]
    if kind:
        where.append("p.media_kind = ?")
        params.append(kind)
    if author:
        where.append("p.author_handle = ?")
        params.append(author)

    clause = f" WHERE {' AND '.join(where)}" if where else ""
    order = {
        "new": "COALESCE(p.created_at, p.added_at) DESC",
        "old": "COALESCE(p.created_at, p.added_at) ASC",
        "added": "p.added_at DESC",
        "size": "total_size DESC",
        "duration": "p.duration DESC NULLS LAST",
    }[sort]

    total = db.query_one(f"SELECT COUNT(*) c FROM posts p{clause}", params)["c"]
    rows = db.query(
        f"""
        SELECT p.*, COALESCE((SELECT SUM(m.filesize) FROM media m
                              WHERE m.post_id = p.id), 0) AS total_size
        FROM posts p{clause}
        ORDER BY {order}
        LIMIT ? OFFSET ?
        """,
        (*params, limit, offset),
    )
    ids = [r["id"] for r in rows]
    tag_map: dict[str, list[str]] = {i: [] for i in ids}
    media_map: dict[str, list] = {i: [] for i in ids}
    if ids:
        placeholders = ",".join("?" * len(ids))
        for r in db.query(
            f"SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON t.id=pt.tag_id"
            f" WHERE pt.post_id IN ({placeholders}) ORDER BY pt.score DESC, t.name",
            ids,
        ):
            tag_map[r["post_id"]].append(r["name"])
        for r in db.query(
            f"SELECT * FROM media WHERE post_id IN ({placeholders}) ORDER BY position, id",
            ids,
        ):
            media_map[r["post_id"]].append(r)

    items = []
    for r in rows:
        payload = post_payload(r, media_map[r["id"]], tag_map[r["id"]])
        if only_ready:
            payload.pop("note", None)
        items.append(payload)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/api/posts")
def list_posts(
    tag: str | None = None,
    q: str | None = None,
    kind: str | None = None,
    author: str | None = None,
    sort: str = Query("new", pattern="^(new|old|added|size|duration)$"),
    limit: int = Query(60, ge=1, le=300),
    offset: int = Query(0, ge=0),
):
    return _query_posts(tag, q, kind, author, sort, limit, offset)


@app.get("/public/posts")
def public_list_posts(
    tag: str | None = None,
    q: str | None = None,
    kind: str | None = None,
    author: str | None = None,
    sort: str = Query("new", pattern="^(new|old|added|size|duration)$"),
    limit: int = Query(60, ge=1, le=300),
    offset: int = Query(0, ge=0),
):
    key = f"list:{tag}:{q}:{kind}:{author}:{sort}:{limit}:{offset}"
    cached = PUBLIC_CACHE.get(key)
    if cached is not None:
        return cached
    result = _query_posts(tag, q, kind, author, sort, limit, offset, only_ready=True)
    PUBLIC_CACHE.set(key, result, 15.0)
    return result


@app.get("/api/posts/{post_id}")
def get_post(post_id: str):
    row = db.get_post(post_id)
    if not row:
        raise HTTPException(404, "推文不存在")
    return post_payload(row)


@app.get("/public/posts/{post_id}")
def public_get_post(post_id: str):
    key = f"post:{post_id}"
    cached = PUBLIC_CACHE.get(key)
    if cached is not None:
        return cached
    row = db.get_post(post_id)
    if not row or row["status"] != "ready":
        raise HTTPException(404, "推文不存在")
    payload = post_payload(row)
    payload.pop("note", None)
    PUBLIC_CACHE.set(key, payload, 60.0)
    return payload


@app.patch("/api/posts/{post_id}")
def update_post(post_id: str, payload: dict = Body(...)):
    row = db.get_post(post_id)
    if not row:
        raise HTTPException(404, "推文不存在")
    if "note" in payload:
        db.execute("UPDATE posts SET note=? WHERE id=?", (payload["note"], post_id))
    if "tags" in payload:
        names = [str(t).strip() for t in payload["tags"] if str(t).strip()]
        db.set_post_tags(post_id, [(n, 1.0) for n in names],
                         source="manual", replace_all=True)
        PUBLIC_CACHE.clear()
    return post_payload(db.get_post(post_id))


@app.post("/api/posts/{post_id}/retag")
def retag_post(post_id: str):
    if not db.get_post(post_id):
        raise HTTPException(404, "推文不存在")
    tags = jobs.apply_auto_tags(post_id)
    return {"tags": tags}


@app.post("/api/posts/retag-all")
def retag_all():
    ids = [r["id"] for r in db.query("SELECT id FROM posts")]
    for post_id in ids:
        jobs.apply_auto_tags(post_id)
    return {"retagged": len(ids)}


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: str, delete_files: bool = True):
    row = db.get_post(post_id)
    if not row:
        raise HTTPException(404, "推文不存在")
    if delete_files:
        refs = {m["path"] for m in db.get_media(post_id)}
        refs.update((row["poster_path"], row["author_avatar"]))
        for ref in filter(storage.is_r2, refs):
            # Avatars are shared. Never delete an object referenced by another post.
            used = db.query_one(
                "SELECT 1 FROM posts WHERE id<>? AND (poster_path=? OR author_avatar=?) "
                "UNION ALL SELECT 1 FROM media WHERE post_id<>? AND path=? LIMIT 1",
                (post_id, ref, ref, post_id, ref),
            )
            if not used:
                try:
                    storage.delete(ref)
                except Exception:
                    raise HTTPException(503, "R2 文件删除失败，请稍后重试")
    db.execute("DELETE FROM post_tags WHERE post_id=?", (post_id,))
    db.execute("DELETE FROM media WHERE post_id=?", (post_id,))
    db.execute("DELETE FROM posts WHERE id=?", (post_id,))
    if delete_files:
        shutil.rmtree(MEDIA_DIR / post_id, ignore_errors=True)
    return {"deleted": post_id}


def _download_post(post_id: str, require_ready: bool = False):
    with tempfile.TemporaryDirectory(prefix="xboard-export-") as directory:
        return _download_post_bundle(post_id, require_ready, Path(directory))


def _download_post_bundle(post_id: str, require_ready: bool, temp_dir: Path):
    """Download all media files (images/video/audio) for a post as a single file.

    Single media file is returned as-is; multiple files are zipped.
    """
    row = db.get_post(post_id)
    if not row:
        raise HTTPException(404, "推文不存在")
    if require_ready and row["status"] != "ready":
        raise HTTPException(404, "推文不存在")

    media_rows = db.get_media(post_id)
    files: list[Path] = []
    seen: set[str] = set()
    media_root = MEDIA_DIR.resolve()
    for m in media_rows:
        rel = (m["path"] or "").strip()
        if not rel:
            continue
        if storage.is_r2(rel):
            name = Path(storage.object_key(rel)).name
            if name in seen:
                continue
            full = temp_dir / name
            try:
                storage.download(rel, full)
            except Exception:
                raise HTTPException(503, "R2 素材读取失败，请稍后重试")
            seen.add(name)
            files.append(full)
            continue
        full = (MEDIA_DIR / rel).resolve()
        # Path traversal guard: only serve files that stay inside MEDIA_DIR.
        try:
            full.relative_to(media_root)
        except ValueError:
            continue
        if not full.is_file():
            continue
        if full.name not in seen:
            seen.add(full.name)
            files.append(full)

    if not files:
        raise HTTPException(404, "该推文没有可下载的素材")

    handle = (row["author_handle"] or "").strip().lstrip("@")
    safe_base = "".join(c for c in handle if c.isalnum() or c in "-_") or post_id

    # Build a plain-text info file carrying the full tweet text + metadata,
    # so a downloaded bundle is self-contained (media + tweet content).
    tags = db.post_tag_names(post_id)
    lines: list[str] = []
    author = (row["author_name"] or "").strip()
    if author:
        lines.append(f"作者: {author}")
    if handle:
        lines.append(f"用户名: @{handle}")
    lines.append(f"推文ID: {post_id}")
    if row["url"]:
        lines.append(f"链接: {row['url']}")
    if row["created_at"]:
        lines.append(f"发布时间: {row['created_at']}")
    if row["lang"]:
        lines.append(f"语言: {row['lang']}")
    if tags:
        lines.append(f"标签: {', '.join(tags)}")
    if row["favorite_count"] is not None:
        lines.append(f"点赞: {row['favorite_count']}")
    if row["reply_count"] is not None:
        lines.append(f"回复: {row['reply_count']}")
    text = (row["text"] or "").strip()
    lines.append("")
    lines.append("—— 推文正文 ——")
    lines.append(text if text else "(无正文)")
    info_text = "\n".join(lines) + "\n"

    # Always package into a zip so the tweet text travels with the media
    # (single media file is no longer returned bare).
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("tweet.txt", info_text)
        for f in files:
            zf.write(f, arcname=f.name)
    buf.seek(0)

    zipname = f"{safe_base}.zip"
    disposition = f"attachment; filename*=UTF-8''{quote(zipname)}"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": disposition},
    )


@app.get("/api/posts/{post_id}/download")
def download_post(post_id: str):
    return _download_post(post_id)


@app.get("/public/posts/{post_id}/download")
def public_download_post(post_id: str):
    return _download_post(post_id, require_ready=True)


@app.post("/api/posts/bulk")
def bulk(payload: dict = Body(...)):
    ids = [str(i) for i in payload.get("ids") or []]
    action = payload.get("action")
    tags = [str(t).strip() for t in payload.get("tags") or [] if str(t).strip()]
    if not ids:
        raise HTTPException(400, "未选择任何推文")
    if action == "add_tags" and tags:
        for post_id in ids:
            existing = db.post_tag_names(post_id)
            merged = list(dict.fromkeys([*existing, *tags]))
            db.set_post_tags(post_id, [(n, 1.0) for n in merged], source="manual")
    elif action == "delete":
        for post_id in ids:
            delete_post(post_id)
    elif action == "retag":
        for post_id in ids:
            jobs.apply_auto_tags(post_id)
    else:
        raise HTTPException(400, f"未知操作: {action}")
    return {"ok": True, "affected": len(ids)}


@app.get("/api/authors")
def authors(limit: int = 40):
    rows = db.query(
        """
        SELECT author_handle, author_name, author_avatar, COUNT(*) AS count
        FROM posts WHERE author_handle IS NOT NULL
        GROUP BY author_handle ORDER BY count DESC LIMIT ?
        """,
        (limit,),
    )
    return {"items": [dict(r) for r in rows]}


# ---------------------------------------------------------------- tags

@app.get("/api/tags")
def get_tags():
    rows = db.tag_counts()
    by_name = {r["name"]: r for r in rows}
    rules = tagger.load_rules().get("categories", {})
    for name, spec in rules.items():
        if name in by_name:
            by_name[name]["color"] = spec.get("color") or by_name[name]["color"]
        else:
            rows.append({"id": None, "name": name, "color": spec.get("color"),
                         "kind": "auto", "count": 0})
    untagged = db.query_one(
        "SELECT COUNT(*) c FROM posts WHERE id NOT IN (SELECT post_id FROM post_tags)"
    )["c"]
    return {"items": rows, "untagged": untagged}


@app.get("/public/tags")
def public_tags():
    cached = PUBLIC_CACHE.get("tags")
    if cached is not None:
        return cached
    rows = db.tag_counts()
    by_name = {r["name"]: r for r in rows}
    rules = tagger.load_rules().get("categories", {})
    for name, spec in rules.items():
        if name in by_name:
            by_name[name]["color"] = spec.get("color") or by_name[name]["color"]
        else:
            rows.append({"id": None, "name": name, "color": spec.get("color"),
                         "kind": "auto", "count": 0})
    result = {"items": rows}
    PUBLIC_CACHE.set("tags", result, 60.0)
    return result


@app.post("/api/tags")
def create_tag(payload: dict = Body(...)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "标签名不能为空")
    tag_id = db.ensure_tag(name, "manual", payload.get("color"))
    return {"id": tag_id, "name": name}


@app.delete("/api/tags/{tag_id}")
def remove_tag(tag_id: int):
    db.delete_tag(tag_id)
    return {"deleted": tag_id}


@app.post("/api/tags/rename")
def rename_tag(payload: dict = Body(...)):
    old = (payload.get("old") or "").strip()
    new = (payload.get("new") or "").strip()
    if not old or not new:
        raise HTTPException(400, "需要 old 和 new")
    db.execute("UPDATE tags SET name=? WHERE name=?", (new, old))
    return {"renamed": [old, new]}


# ---------------------------------------------------------------- settings / rules

@app.get("/api/settings")
def get_settings():
    s = load_settings()
    s["llm_api_key"] = "***" if s.get("llm_api_key") else ""
    s["cookies_present"] = COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 0
    return s


@app.post("/api/settings")
def post_settings(payload: dict = Body(...)):
    if payload.get("llm_api_key") == "***":
        payload.pop("llm_api_key")
    return save_settings(payload)


@app.get("/api/rules")
def get_rules():
    return tagger.load_rules()


@app.post("/api/rules")
def post_rules(payload: dict = Body(...)):
    rules = payload.get("rules") or payload
    if "categories" not in rules:
        raise HTTPException(400, "规则必须包含 categories")
    tagger.save_rules(rules)
    return {"ok": True, "categories": len(rules["categories"])}


@app.get("/api/stats")
def stats():
    post_count = db.query_one("SELECT COUNT(*) c FROM posts")["c"]
    ready = db.query_one("SELECT COUNT(*) c FROM posts WHERE status='ready'")["c"]
    failed = db.query_one("SELECT COUNT(*) c FROM posts WHERE status='failed'")["c"]
    size = db.query_one("SELECT COALESCE(SUM(filesize),0) c FROM media")["c"]
    videos = db.query_one(
        "SELECT COUNT(DISTINCT post_id) c FROM media WHERE kind='video'"
    )["c"]
    images = db.query_one("SELECT COUNT(*) c FROM media WHERE kind='image'")["c"]
    queued = db.query_one(
        "SELECT COUNT(*) c FROM jobs WHERE status IN ('queued','running')"
    )["c"]
    latest = db.query_one("SELECT MAX(added_at) c FROM posts")["c"]
    return {
        "posts": post_count, "ready": ready, "failed": failed,
        "videos": videos, "images": images, "size": size,
        "pending_jobs": queued, "tags": len(db.tag_counts()),
        "last_added": latest,
        "disk_free": shutil.disk_usage(MEDIA_DIR).free,
    }


@app.exception_handler(404)
async def not_found(request, exc):
    if request.url.path.startswith("/api/") or request.url.path.startswith("/public/"):
        return JSONResponse({"detail": getattr(exc, "detail", "not found")}, 404)
    return FileResponse(str(STATIC_DIR / "public.html"))
