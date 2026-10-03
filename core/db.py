"""SQLite persistence layer for XBoard."""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

from .config import DB_PATH

_local = threading.local()
_write_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS posts (
    id               TEXT PRIMARY KEY,
    url              TEXT,
    author_name      TEXT,
    author_handle    TEXT,
    author_avatar    TEXT,
    author_verified  INTEGER DEFAULT 0,
    text             TEXT DEFAULT '',
    lang             TEXT,
    created_at       TEXT,
    favorite_count   INTEGER DEFAULT 0,
    reply_count      INTEGER DEFAULT 0,
    media_kind       TEXT DEFAULT 'text',
    duration         REAL,
    width            INTEGER,
    height           INTEGER,
    poster_path      TEXT,
    note             TEXT DEFAULT '',
    status           TEXT DEFAULT 'ready',
    error            TEXT,
    source           TEXT,
    tagged_at        TEXT,
    added_at         TEXT
);

CREATE TABLE IF NOT EXISTS media (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id   TEXT NOT NULL,
    kind      TEXT NOT NULL,
    path      TEXT NOT NULL,
    mime      TEXT,
    width     INTEGER,
    height    INTEGER,
    duration  REAL,
    filesize  INTEGER,
    position  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_media_post ON media(post_id);

CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    color      TEXT DEFAULT '#6b7280',
    kind       TEXT DEFAULT 'auto',
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS post_tags (
    post_id TEXT NOT NULL,
    tag_id  INTEGER NOT NULL,
    source  TEXT DEFAULT 'auto',
    score   REAL DEFAULT 0,
    PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);

CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    url         TEXT,
    post_id     TEXT,
    status      TEXT DEFAULT 'queued',
    stage       TEXT,
    progress    REAL DEFAULT 0,
    message     TEXT,
    error       TEXT,
    created_at  TEXT,
    started_at  TEXT,
    finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
"""

TAG_COLORS = [
    "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#eab308",
    "#22c55e", "#14b8a6", "#06b6d4", "#f43f5e", "#a3e635",
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def init_db() -> None:
    with _write_lock:
        conn = get_conn()
        conn.executescript(SCHEMA)
        conn.commit()


def query(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return list(get_conn().execute(sql, tuple(params)).fetchall())


def query_one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    return get_conn().execute(sql, tuple(params)).fetchone()


def execute(sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
    with _write_lock:
        conn = get_conn()
        cur = conn.execute(sql, tuple(params))
        conn.commit()
        return cur


def execute_named(sql: str, params: dict) -> sqlite3.Cursor:
    """For SQL that uses :named placeholders."""
    with _write_lock:
        conn = get_conn()
        cur = conn.execute(sql, params)
        conn.commit()
        return cur


# ---------------------------------------------------------------- posts

def upsert_post(post: dict) -> None:
    cols = [
        "id", "url", "author_name", "author_handle", "author_avatar",
        "author_verified", "text", "lang", "created_at", "favorite_count",
        "reply_count", "media_kind", "duration", "width", "height",
        "poster_path", "note", "status", "error", "source", "tagged_at",
        "added_at",
    ]
    values = {c: post.get(c) for c in cols}
    values["added_at"] = values["added_at"] or now()
    placeholders = ", ".join(f":{c}" for c in cols)
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "id")
    execute_named(
        f"INSERT INTO posts ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(id) DO UPDATE SET {updates}",
        values,
    )


def replace_media(post_id: str, items: list[dict]) -> None:
    with _write_lock:
        conn = get_conn()
        conn.execute("DELETE FROM media WHERE post_id=?", (post_id,))
        for pos, item in enumerate(items):
            conn.execute(
                "INSERT INTO media (post_id, kind, path, mime, width, height,"
                " duration, filesize, position) VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    post_id, item.get("kind"), item.get("path"), item.get("mime"),
                    item.get("width"), item.get("height"), item.get("duration"),
                    item.get("filesize"), item.get("position", pos),
                ),
            )
        conn.commit()


def get_post(post_id: str) -> sqlite3.Row | None:
    return query_one("SELECT * FROM posts WHERE id=?", (post_id,))


def get_media(post_id: str) -> list[sqlite3.Row]:
    return query("SELECT * FROM media WHERE post_id=? ORDER BY position, id", (post_id,))


# ---------------------------------------------------------------- tags

def ensure_tag(name: str, kind: str = "auto", color: str | None = None) -> int:
    name = name.strip()
    row = query_one("SELECT id FROM tags WHERE name=?", (name,))
    if row:
        return int(row["id"])
    if color is None:
        count = query_one("SELECT COUNT(*) AS c FROM tags")
        color = TAG_COLORS[int(count["c"]) % len(TAG_COLORS)]
    cur = execute(
        "INSERT INTO tags (name, color, kind, created_at) VALUES (?,?,?,?)",
        (name, color, kind, now()),
    )
    return int(cur.lastrowid)


def set_post_tags(post_id: str, tags: list[tuple[str, float]],
                  source: str = "auto", replace_source: bool = True) -> None:
    with _write_lock:
        conn = get_conn()
        if replace_source:
            conn.execute(
                "DELETE FROM post_tags WHERE post_id=? AND source=?", (post_id, source)
            )
        for name, score in tags:
            name = name.strip()
            if not name:
                continue
            row = conn.execute("SELECT id FROM tags WHERE name=?", (name,)).fetchone()
            if row:
                tag_id = row["id"]
            else:
                count = conn.execute("SELECT COUNT(*) AS c FROM tags").fetchone()["c"]
                conn.execute(
                    "INSERT INTO tags (name, color, kind, created_at) VALUES (?,?,?,?)",
                    (name, TAG_COLORS[count % len(TAG_COLORS)], source, now()),
                )
                tag_id = conn.execute(
                    "SELECT id FROM tags WHERE name=?", (name,)
                ).fetchone()["id"]
            conn.execute(
                "INSERT INTO post_tags (post_id, tag_id, source, score) VALUES (?,?,?,?) "
                "ON CONFLICT(post_id, tag_id) DO UPDATE SET source=excluded.source,"
                " score=excluded.score",
                (post_id, tag_id, source, score),
            )
        conn.commit()


def post_tag_names(post_id: str) -> list[str]:
    rows = query(
        "SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id "
        "WHERE pt.post_id=? ORDER BY pt.score DESC, t.name",
        (post_id,),
    )
    return [r["name"] for r in rows]


def tag_counts() -> list[dict]:
    rows = query(
        """
        SELECT t.id, t.name, t.color, t.kind, COUNT(pt.post_id) AS count
        FROM tags t
        JOIN post_tags pt ON pt.tag_id = t.id
        GROUP BY t.id
        ORDER BY count DESC, t.name
        """
    )
    return [dict(r) for r in rows]


def delete_tag(tag_id: int) -> None:
    with _write_lock:
        conn = get_conn()
        conn.execute("DELETE FROM post_tags WHERE tag_id=?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id=?", (tag_id,))
        conn.commit()


# ---------------------------------------------------------------- jobs

def create_job(job_id: str, url: str, post_id: str | None) -> None:
    execute(
        "INSERT INTO jobs (id, url, post_id, status, stage, progress, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (job_id, url, post_id, "queued", "排队中", 0.0, now()),
    )


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    sets = ", ".join(f"{k}=?" for k in fields)
    execute(f"UPDATE jobs SET {sets} WHERE id=?", (*fields.values(), job_id))


def get_job(job_id: str) -> sqlite3.Row | None:
    return query_one("SELECT * FROM jobs WHERE id=?", (job_id,))


def list_jobs(limit: int = 30) -> list[dict]:
    rows = query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,))
    return [dict(r) for r in rows]


def requeue_stale_jobs() -> int:
    """Jobs left running by a crash/restart go back to the queue."""
    cur = execute(
        "UPDATE jobs SET status='queued', stage='已重新排队', progress=0 "
        "WHERE status IN ('running','queued')"
    )
    return cur.rowcount