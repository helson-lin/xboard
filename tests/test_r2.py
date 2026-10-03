"""Offline tests: migration failure/retry, shared objects and remote exports."""
import io
import os
import sqlite3
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from botocore.exceptions import ClientError
from core import config as core_config, db, storage
import migrate_r2


class FakeR2:
    def __init__(self):
        self.objects = {}
        self.uploads = 0
        self.fail_upload = False

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        body, extra = self.objects[Key]
        return {"ContentLength": len(body), "Metadata": extra["Metadata"]}

    def upload_file(self, path, bucket, key, ExtraArgs):
        if self.fail_upload:
            raise OSError("offline upload failure")
        self.uploads += 1
        self.objects[key] = (Path(path).read_bytes(), ExtraArgs)

    def download_file(self, bucket, key, path):
        Path(path).write_bytes(self.objects[key][0])

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        return "https://r2.example/" + Params["Key"] + "?signed=temporary"


class StorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Import API against an isolated DB; never initialise the user's DB.
        cls.import_dir = tempfile.TemporaryDirectory()
        with (patch.object(db, "DB_PATH", Path(cls.import_dir.name) / "import.db"),
              patch.object(db, "_local", threading.local()),
              patch.object(core_config, "STATIC_DIR", Path(cls.import_dir.name)),
              patch.dict(os.environ, {"XBOARD_PASSWORD": "test-only-password", "XBOARD_API_TOKEN": "test-only-token"})):
            import app
            cls.app = app
            db.get_conn().close()

    @classmethod
    def tearDownClass(cls):
        cls.import_dir.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.r2 = FakeR2()
        self.cfg = {"backend": "r2", "prefix": "test", "bucket": "private", "url_ttl": 3600}
        self.patches = [patch.object(storage, "MEDIA_DIR", self.root),
                        patch.object(storage, "config", return_value=self.cfg),
                        patch.object(storage, "client", return_value=self.r2)]
        for p in self.patches:
            p.start()
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(db.SCHEMA)
        (self.root / "1").mkdir()
        (self.root / "1" / "photo.jpg").write_bytes(b"image-content")
        (self.root / "avatar.jpg").write_bytes(b"avatar-content")
        self.conn.execute("INSERT INTO posts (id,text,status,author_avatar) VALUES ('1','hello','ready','https://pbs.twimg.com/avatar.jpg')")
        self.conn.execute("INSERT INTO media (post_id,kind,path) VALUES ('1','image','1/photo.jpg')")
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def post(self):
        return self.conn.execute("SELECT * FROM posts WHERE id='1'").fetchone()

    def test_upload_retry_and_content_type(self):
        source = self.root / "1" / "photo.jpg"
        first = storage.upload(source, "posts/1")
        self.assertEqual(storage.upload(source, "posts/1"), first)
        self.assertEqual(self.r2.uploads, 1)
        self.assertEqual(self.r2.objects[storage.object_key(first)][1]["ContentType"], "image/jpeg")
        source.write_bytes(b"changed-image")
        self.assertNotEqual(storage.upload(source, "posts/1"), first)
        self.assertIn(storage.object_key(first), self.r2.objects)

    def test_avatar_failure_keeps_entire_post_local(self):
        with patch.object(migrate_r2.downloader, "download_avatar", side_effect=OSError()), patch.object(migrate_r2.downloader, "fetch_tweet_meta", return_value=None):
            with self.assertRaises(OSError):
                migrate_r2.migrate_post(self.conn, self.post())
        self.assertEqual(self.conn.execute("SELECT path FROM media").fetchone()[0], "1/photo.jpg")
        self.assertTrue(self.post()["author_avatar"].startswith("https://pbs.twimg.com/"))

    def test_success_resume_and_local_original_preserved(self):
        with patch.object(migrate_r2.downloader, "download_avatar", return_value=self.root / "avatar.jpg"):
            self.assertTrue(migrate_r2.migrate_post(self.conn, self.post()))
            self.assertFalse(migrate_r2.migrate_post(self.conn, self.post()))
        self.assertTrue(storage.is_r2(self.post()["author_avatar"]))
        self.assertTrue((self.root / "1" / "photo.jpg").is_file())
        self.assertEqual(self.r2.uploads, 2)

    def test_missing_file_does_not_switch(self):
        (self.root / "1" / "photo.jpg").unlink()
        self.assertEqual(len(migrate_r2.inventory(self.conn)["missing_local"]), 1)
        with self.assertRaises(FileNotFoundError):
            migrate_r2.migrate_post(self.conn, self.post())
        self.assertEqual(self.conn.execute("SELECT path FROM media").fetchone()[0], "1/photo.jpg")

    def test_new_assets_fail_without_returning_external_avatar(self):
        post = {"id": "1", "author_avatar": "https://pbs.twimg.com/avatar.jpg", "poster_path": "1/photo.jpg"}
        media = [{"path": "1/photo.jpg"}]
        with patch.object(migrate_r2.downloader, "download_avatar", return_value=self.root / "avatar.jpg"):
            storage.store_post_assets(post, media, self.root / "1")
        self.assertTrue(all(storage.is_r2(ref) for ref in (post["author_avatar"], post["poster_path"], media[0]["path"])))
        self.assertNotIn("signed", post["author_avatar"])

    def test_upload_failure_keeps_references(self):
        self.r2.fail_upload = True
        post = {"id": "1", "author_avatar": "https://pbs.twimg.com/avatar.jpg", "poster_path": "1/photo.jpg"}
        media = [{"path": "1/photo.jpg"}]
        with self.assertRaises(OSError):
            storage.store_post_assets(post, media, self.root / "1")
        self.assertEqual(media[0]["path"], "1/photo.jpg")
        self.assertEqual(post["author_avatar"], "https://pbs.twimg.com/avatar.jpg")

    def test_real_sdk_presigns_without_network(self):
        import urllib.parse
        client = storage._client("https://account.r2.cloudflarestorage.com", "test-key", "test-secret")
        url = client.generate_presigned_url("get_object", Params={"Bucket": "private", "Key": "xboard/photo.jpg"}, ExpiresIn=3600)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(query["X-Amz-Algorithm"], ["AWS4-HMAC-SHA256"])
        self.assertEqual(query["X-Amz-Expires"], ["3600"])

    def test_paths_and_local_compatibility(self):
        with self.assertRaises(ValueError):
            storage.local_path("../secret")
        with self.assertRaises(ValueError):
            storage.local_path("/etc/passwd")
        self.assertEqual(storage.url("1/photo.jpg"), "/media/1/photo.jpg")
        self.assertEqual(storage.url("https://pbs.twimg.com/a.jpg"), "https://pbs.twimg.com/a.jpg")

    def test_remote_bundle_and_avatar_serialisation(self):
        with patch.object(migrate_r2.downloader, "download_avatar", return_value=self.root / "avatar.jpg"):
            migrate_r2.migrate_post(self.conn, self.post())
        rows = list(self.conn.execute("SELECT * FROM media"))
        with patch.object(db, "get_post", return_value=self.post()), patch.object(db, "get_media", return_value=rows), patch.object(db, "post_tag_names", return_value=[]):
            payload = self.app.post_payload(self.post())
            self.assertTrue(payload["author_avatar"].startswith("https://r2.example/"))
            response = self.app._download_post("1")
        with zipfile.ZipFile(io.BytesIO(response.body)) as archive:
            self.assertEqual(archive.read("photo.jpg"), b"image-content")
            self.assertIn("hello", archive.read("tweet.txt").decode())

    def test_delete_preserves_shared_avatar(self):
        image = storage.upload(self.root / "1" / "photo.jpg", "posts/1")
        avatar = storage.upload(self.root / "avatar.jpg", "avatars")
        post = {"poster_path": image, "author_avatar": avatar}
        def referenced(sql, params):
            return {"exists": 1} if params[1] == avatar else None
        with patch.object(db, "get_post", return_value=post), patch.object(db, "get_media", return_value=[{"path": image}]), patch.object(db, "query_one", side_effect=referenced), patch.object(db, "execute"), patch.object(self.app.shutil, "rmtree"):
            self.app.delete_post("1")
        self.assertNotIn(storage.object_key(image), self.r2.objects)
        self.assertIn(storage.object_key(avatar), self.r2.objects)


if __name__ == "__main__":
    unittest.main()
