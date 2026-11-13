"""Path-picking regressions for the yt-dlp download flow."""
import tempfile
import unittest
from pathlib import Path

from core import downloader


class PickDownloadedFileTests(unittest.TestCase):
    def test_empty_reported_paths_fall_back_to_the_real_file(self):
        """Path("") 是 "."，曾经被当成下载结果，导致 relative_to 崩掉。"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            video = dest / "video.mp4"
            video.write_bytes(b"x")
            info = {"_filename": "", "requested_downloads": [{"filepath": ""}]}

            got = downloader._pick_downloaded_file(info, dest)

            self.assertEqual(got, video.resolve())

    def test_reported_file_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            video = dest / "video.mp4"
            video.write_bytes(b"x")
            info = {"requested_downloads": [{"filepath": str(video)}]}

            self.assertEqual(downloader._pick_downloaded_file(info, dest), video.resolve())

    def test_directory_is_not_a_media_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            (dest / "video.mp4").mkdir()
            info = {"requested_downloads": [{"filepath": str(dest / "video.mp4")}]}

            self.assertIsNone(downloader._pick_downloaded_file(info, dest))

    def test_missing_file_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(downloader._pick_downloaded_file({}, Path(tmp)))

    def test_outside_media_dir_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(downloader.DownloadError):
                downloader._media_relative(Path(tmp) / "video.mp4")


if __name__ == "__main__":
    unittest.main()
