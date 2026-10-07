import sqlite3
import unittest
from unittest.mock import patch
from core import db


class TagCountsTests(unittest.TestCase):
    def test_new_unused_tag_remains_visible_and_counts_used_tags(self):
        with sqlite3.connect(':memory:') as conn:
            conn.row_factory = sqlite3.Row
            conn.executescript(db.SCHEMA)
            with patch.object(db, 'get_conn', return_value=conn):
                empty = db.ensure_tag('自定义', 'manual', '#c084fc')
                used = db.ensure_tag('已使用', 'manual')
                conn.execute("INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)", ('post-1', used))
                rows = {row['id']: row for row in db.tag_counts()}
                self.assertEqual(rows[empty]['count'], 0)
                self.assertEqual(rows[empty]['color'], '#c084fc')
                self.assertEqual(rows[used]['count'], 1)
