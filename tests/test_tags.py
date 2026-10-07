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

    def test_manual_edit_replaces_auto_tags_and_can_clear_all(self):
        with sqlite3.connect(':memory:') as conn:
            conn.row_factory = sqlite3.Row
            conn.executescript(db.SCHEMA)
            with patch.object(db, 'get_conn', return_value=conn):
                db.set_post_tags('post-1', [('自动', 1.0)], source='auto')
                db.set_post_tags('post-1', [('自定义', 1.0)], source='manual', replace_all=True)
                self.assertEqual(db.post_tag_names('post-1'), ['自定义'])
                db.set_post_tags('post-1', [], source='manual', replace_all=True)
                self.assertEqual(db.post_tag_names('post-1'), [])
