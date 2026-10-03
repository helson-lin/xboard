"""Local media and private R2 objects. Persist references, never signed URLs."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
from functools import lru_cache
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from .config import CONFIG_DIR, MEDIA_DIR


def config() -> dict:
    path = Path(os.environ.get("XBOARD_STORAGE_CONFIG", CONFIG_DIR / "storage.json"))
    result = json.loads(path.read_text()) if path.exists() else {}
    for key in ("backend", "endpoint", "bucket", "access_key_id", "secret_access_key", "prefix"):
        value = os.environ.get("XBOARD_STORAGE_" + key.upper())
        if value is not None:
            result[key] = value
    result.setdefault("backend", "local")
    result.setdefault("prefix", "xboard")
    result.setdefault("url_ttl", 3600)
    if result["backend"] not in ("local", "r2"):
        raise ValueError("storage backend 必须是 local 或 r2")
    return result


def enabled() -> bool:
    return config()["backend"] == "r2"


def is_r2(ref: str | None) -> bool:
    return bool(ref and ref.startswith("r2://"))


def object_key(ref: str) -> str:
    if not is_r2(ref):
        raise ValueError("不是 R2 对象引用")
    key = ref[5:]
    if not key or key.startswith("/") or ".." in PurePosixPath(key).parts:
        raise ValueError("无效的 R2 对象路径")
    return key


def local_path(ref: str) -> Path:
    if ref.startswith("/media/"):
        ref = ref[len("/media/"):]
    if "://" in ref or Path(ref).is_absolute():
        raise ValueError("无效的本地媒体路径")
    path = (MEDIA_DIR / ref).resolve()
    path.relative_to(MEDIA_DIR.resolve())
    return path


@lru_cache(maxsize=4)
def _client(endpoint: str, access_key: str, secret_key: str):
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise RuntimeError("R2 需要 boto3：python3 -m pip install -r requirements-r2.txt") from exc
    return boto3.client(
        "s3", endpoint_url=endpoint, region_name="auto",
        aws_access_key_id=access_key, aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4", retries={"mode": "standard", "max_attempts": 4},
                      request_checksum_calculation="when_required", response_checksum_validation="when_required"),
    )


def client():
    cfg = config()
    required = ("endpoint", "bucket", "access_key_id", "secret_access_key")
    if any(not cfg.get(k) for k in required):
        raise RuntimeError("请在私有 storage.json 中配置 R2 endpoint、bucket 和 S3 密钥")
    if not cfg["endpoint"].startswith("https://"):
        raise ValueError("R2 endpoint 必须使用 HTTPS")
    return _client(cfg["endpoint"], cfg["access_key_id"], cfg["secret_access_key"])


def head(ref: str) -> dict | None:
    from botocore.exceptions import ClientError
    try:
        return client().head_object(Bucket=config()["bucket"], Key=object_key(ref))
    except ClientError as exc:
        if str(exc.response.get("Error", {}).get("Code")) in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def upload(path: Path, namespace: str) -> str:
    """Content-addressed keys make retries safe without overwriting old assets."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    sha = digest.hexdigest()
    cfg = config()
    prefix = cfg["prefix"].strip("/")
    ref = "r2://" + "/".join(filter(None, (prefix, namespace.strip("/"), sha, path.name)))
    object_key(ref)
    size = path.stat().st_size
    def matches(info):
        return info and info.get("ContentLength") == size and info.get("Metadata", {}).get("sha256") == sha
    if not matches(head(ref)):
        client().upload_file(str(path), cfg["bucket"], object_key(ref), ExtraArgs={
            "ContentType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            "Metadata": {"sha256": sha},
        })
    if not matches(head(ref)):
        raise RuntimeError("R2 上传校验失败")
    return ref


def url(ref: str | None) -> str | None:
    if not ref:
        return None
    if is_r2(ref):
        ttl = max(60, min(604800, int(config()["url_ttl"])))
        return client().generate_presigned_url(
            "get_object", Params={"Bucket": config()["bucket"], "Key": object_key(ref)}, ExpiresIn=ttl,
        )
    if ref.startswith(("https://", "http://", "/media/")):
        return ref
    return "/media/" + quote(ref, safe="/")


def download(ref: str, target: Path) -> None:
    client().download_file(config()["bucket"], object_key(ref), str(target))


def delete(ref: str) -> None:
    client().delete_object(Bucket=config()["bucket"], Key=object_key(ref))


def store_post_assets(post: dict, media: list[dict], dest_dir: Path) -> None:
    """Upload everything before replacing any DB references; propagate failures."""
    from .downloader import download_avatar
    if not enabled():
        return
    client()  # fail early for missing configuration
    namespace = "posts/" + str(post["id"])
    converted = [upload(local_path(m["path"]), namespace) for m in media]
    poster = upload(local_path(post["poster_path"]), namespace) if post.get("poster_path") else None
    avatar = post.get("author_avatar")
    if avatar and not is_r2(avatar):
        if avatar.startswith(("https://", "http://")):
            avatar_path = download_avatar(avatar)
        else:
            avatar_path = local_path(avatar)
        avatar = upload(avatar_path, "avatars")
    for item, ref in zip(media, converted):
        item["path"] = ref
    post["poster_path"] = poster
    post["author_avatar"] = avatar
