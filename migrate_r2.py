#!/usr/bin/env python3
"""Preview or migrate historical media/avatars, preserving all local originals."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from core import downloader, storage
from core.config import DATA_DIR, DB_PATH


def assets(conn, post):
    items = [("media", r["id"], r["path"]) for r in conn.execute(
        "SELECT id,path FROM media WHERE post_id=? ORDER BY id", (post["id"],))]
    for field in ("poster_path", "author_avatar"):
        if post[field]:
            items.append((field, None, post[field]))
    return items


def inventory(conn):
    result = {"posts": 0, "local_assets": 0, "r2_assets": 0,
              "external_avatars": 0, "unique_external_avatars": 0, "missing_local": [], "local_bytes": 0}
    avatars, files = set(), set()
    for post in conn.execute("SELECT * FROM posts"):
        result["posts"] += 1
        for kind, _, ref in assets(conn, post):
            if storage.is_r2(ref):
                result["r2_assets"] += 1
            elif kind == "author_avatar" and ref.startswith(("https://", "http://")):
                result["external_avatars"] += 1
                avatars.add(ref)
            else:
                result["local_assets"] += 1
                try:
                    path = storage.local_path(ref)
                    if not path.is_file():
                        raise FileNotFoundError()
                    if path not in files:
                        result["local_bytes"] += path.stat().st_size
                        files.add(path)
                except (ValueError, FileNotFoundError):
                    result["missing_local"].append({"post_id": post["id"], "kind": kind})
    result["unique_external_avatars"] = len(avatars)
    return result


def ensure_stopped():
    pidfile = DATA_DIR / "runtime" / "daemon.pid"
    if pidfile.exists():
        try:
            os.kill(int(pidfile.read_text().strip()), 0)
        except ProcessLookupError:
            return
        raise RuntimeError("请先停止 Xboard supervisor 和 API，再执行迁移；预览无需停止服务")


def migrate_post(conn, post):
    before = assets(conn, post)
    replacements = []
    for kind, asset_id, ref in before:
        if storage.is_r2(ref):
            if storage.head(ref) is None:
                raise RuntimeError("已迁移对象在 R2 中不存在")
            continue
        if kind == "author_avatar" and ref.startswith(("https://", "http://")):
            try:
                path = downloader.download_avatar(ref)
            except Exception:
                # An old avatar URL may have expired after the author changed it.
                meta = downloader.fetch_tweet_meta(post["id"])
                fresh = meta.get("author_avatar") if meta else None
                if not fresh or fresh == ref:
                    raise
                path = downloader.download_avatar(fresh)
        else:
            path = storage.local_path(ref)
        namespace = "avatars" if kind == "author_avatar" else "posts/" + post["id"]
        new = storage.upload(path, namespace)
        replacements.append((kind, asset_id, ref, new))
    if not replacements:
        return False
    # Switch an entire post only after ALL its referenced assets are verified.
    try:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT * FROM posts WHERE id=?", (post["id"],)).fetchone()
        if not current or assets(conn, current) != before:
            raise RuntimeError("迁移期间数据已变化，未更新引用，请重试")
        for kind, asset_id, old, new in replacements:
            if kind == "media":
                conn.execute("UPDATE media SET path=? WHERE id=? AND path=?", (new, asset_id, old))
            else:
                conn.execute(f"UPDATE posts SET {kind}=? WHERE id=? AND {kind}=?", (new, post["id"], old))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="实际上传并更新数据库（保留本地文件）")
    mode.add_argument("--verify", action="store_true", help="检查所有媒体和头像均已在 R2")
    args = parser.parse_args()
    conn = sqlite3.connect(f"file:{DB_PATH}?mode={'rw' if args.apply else 'ro'}", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    preview = inventory(conn)
    print(json.dumps(preview, ensure_ascii=False, indent=2))
    if not args.apply and not args.verify:
        return 0
    storage.client()
    if args.verify:
        failures = []
        for post in conn.execute("SELECT * FROM posts"):
            for kind, _, ref in assets(conn, post):
                try:
                    if not storage.is_r2(ref) or storage.head(ref) is None:
                        raise RuntimeError("对象未迁移或不存在")
                except Exception as exc:
                    failures.append({"post_id": post["id"], "kind": kind, "error_type": type(exc).__name__})
        print(json.dumps({"verified": not failures, "failures": failures}, ensure_ascii=False, indent=2))
        return 1 if failures else 0
    ensure_stopped()
    if conn.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running') LIMIT 1").fetchone():
        raise RuntimeError("有未完成的下载任务，请完成任务后再迁移")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    backup_dir = DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / ("pre-r2-" + stamp + ".db")
    with sqlite3.connect(backup) as destination:
        conn.backup(destination)
    backup.chmod(0o600)
    report = {"backup": str(backup), "migrated": [], "already_migrated": [], "failed": []}
    report_path = backup_dir / ("r2-migration-" + stamp + ".json")
    posts = list(conn.execute("SELECT * FROM posts ORDER BY id"))
    for post in posts:
        try:
            changed = migrate_post(conn, post)
            report["migrated" if changed else "already_migrated"].append(post["id"])
        except Exception as exc:
            # Avoid including request credentials or URLs in the persisted report.
            report["failed"].append({"post_id": post["id"], "error_type": type(exc).__name__})
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        report_path.chmod(0o600)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("报告：", report_path)
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
