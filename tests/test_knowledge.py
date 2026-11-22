"""Knowledge lifecycle, search and inventory isolation on disposable databases."""

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import database
from src.knowledge import (
    delete_article,
    delete_category,
    get_article,
    list_articles,
    save_article,
    save_category,
)
from src.prints import undo_print


class KnowledgeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(
            database, "DB", Path(self.directory.name) / "test.sqlite3"
        )
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        database.initialize()
        with database.connect() as conn:
            self.category = conn.execute(
                "SELECT id FROM knowledge_categories ORDER BY id"
            ).fetchone()["id"]
            self.print_id = conn.execute(
                "INSERT INTO prints (name,print_date,note) VALUES ('PETG test','2026-11-14','God pasform')"
            ).lastrowid
            self.spool_id = conn.execute(
                "INSERT INTO filaments (name,manufacturer,material,weight,remaining,label_token) VALUES ('Test','Test','PETG Basic',1000,990,'knowledge-test')"
            ).lastrowid
            conn.execute(
                "INSERT INTO consumption (filament_id,print_id,grams) VALUES (?,?,10)",
                (self.spool_id, self.print_id),
            )
        self.payload = {
            "title": "PEI og PETG",
            "summary": "PLA, PETG og pasform",
            "category_id": self.category,
            "confidence": "hypothesis",
            "status": "draft",
            "tags": ["PETG", "petg"],
            "sources": [
                {
                    "print_id": self.print_id,
                    "note": "Afkølet plade",
                    "relationship_type": "test",
                }
            ],
        }

    def test_lifecycle_sources_and_repeatable_migration(self):
        with database.connect() as conn:
            identity = save_article(conn, self.payload)
        database.initialize()
        with database.connect() as conn:
            article = get_article(conn, identity)
            self.assertEqual(article["status"], "draft")
            self.assertEqual(len(article["tags"]), 1)
            self.assertEqual(article["sources"][0]["materials"], ["PETG Basic"])
            created = article["created_at"]
            save_article(conn, dict(self.payload, status="published"), identity)
            article = get_article(conn, identity)
            self.assertTrue(article["published_at"])
            save_article(conn, dict(self.payload, status="archived"), identity)
            self.assertEqual(get_article(conn, identity)["created_at"], created)
            self.assertEqual(
                conn.execute(
                    "SELECT remaining FROM filaments WHERE id=?", (self.spool_id,)
                ).fetchone()["remaining"],
                990,
            )

    def test_verification_requires_explicit_confirmation(self):
        with database.connect() as conn:
            with self.assertRaises(ValueError):
                save_article(conn, dict(self.payload, confidence="verified"))
            identity = save_article(
                conn, dict(self.payload, confidence="verified", confirm_verified=True)
            )
            save_article(conn, dict(self.payload, confidence="verified"), identity)
            self.assertEqual(get_article(conn, identity)["confidence"], "verified")

    def test_source_deletion_protection_and_unlink(self):
        with database.connect() as conn:
            identity = save_article(conn, dict(self.payload, status="published"))
            with self.assertRaises(ValueError):
                undo_print(conn, self.print_id)
            self.assertEqual(
                conn.execute(
                    "SELECT remaining FROM filaments WHERE id=?", (self.spool_id,)
                ).fetchone()["remaining"],
                990,
            )
            save_article(
                conn, dict(self.payload, status="published", sources=[]), identity
            )
            undo_print(conn, self.print_id)
            self.assertEqual(get_article(conn, identity)["status"], "published")
            self.assertEqual(
                conn.execute(
                    "SELECT remaining FROM filaments WHERE id=?", (self.spool_id,)
                ).fetchone()["remaining"],
                1000,
            )

    def test_search_and_combined_filters(self):
        with database.connect() as conn:
            save_article(conn, self.payload)
            for filters in (
                {"q": ["pei"]},
                {"q": ["PLA"]},
                {
                    "material": ["PETG Basic"],
                    "tag": ["petg"],
                    "confidence": ["hypothesis"],
                    "category_id": [str(self.category)],
                    "status": ["draft"],
                },
            ):
                self.assertEqual(len(list_articles(conn, filters)), 1)
            for filters in (
                {"q": ["%"]},
                {"q": ["' OR 1=1 --"]},
                {"material": ["ABS"]},
                {"confidence": ["verified"]},
            ):
                self.assertEqual(list_articles(conn, filters), [])

    def test_invalid_update_is_atomic(self):
        with database.connect() as conn:
            identity = save_article(conn, self.payload)
        with self.assertRaises(ValueError), database.connect() as conn:
            save_article(
                conn,
                dict(self.payload, title="Ændret", sources=[{"print_id": 999999}]),
                identity,
            )
        with database.connect() as conn:
            self.assertEqual(
                get_article(conn, identity)["title"], self.payload["title"]
            )
            self.assertEqual(len(get_article(conn, identity)["sources"]), 1)

    def test_ai_context_excludes_images_and_rejects_unfinished_or_empty_notes(self):
        from src.knowledge_ai import AIError, source_context

        with database.connect() as conn:
            conn.execute(
                "UPDATE prints SET image='private-image',project_url='https://private.example' WHERE id=?",
                (self.print_id,),
            )
            context, categories = source_context(conn, self.print_id)
            self.assertEqual(
                set(context), {"name", "note", "status", "print_date", "materials"}
            )
            self.assertEqual(context["materials"], ["PETG Basic"])
            self.assertTrue(categories)
            for status, note in (
                ("pending", "Erfaring"),
                ("in_progress", "Erfaring"),
                ("completed", "  "),
            ):
                conn.execute(
                    "UPDATE prints SET status=?,note=? WHERE id=?",
                    (status, note, self.print_id),
                )
                with self.assertRaises(AIError):
                    source_context(conn, self.print_id)
            with self.assertRaises(AIError) as error:
                source_context(conn, 999999)
            self.assertEqual(error.exception.status, 404)

    def test_text_search_matches_tags_without_interpreting_wildcards(self):
        with database.connect() as conn:
            identity = save_article(
                conn,
                dict(self.payload, tags=["EnkeltFund", "PEI_Klar%"], status="archived"),
            )
            for query in ("enkelt", "PEI_Klar%"):
                self.assertEqual(
                    [article["id"] for article in list_articles(conn, {"q": [query]})],
                    [identity],
                )
            self.assertEqual(list_articles(conn, {"q": ["PEI%Klar"]}), [])

    def test_category_rename_preserves_articles_and_deletion_is_guarded(self):
        with database.connect() as conn:
            article = save_article(conn, dict(self.payload, status="archived"))
            save_category(conn, {"name": "Omdøbt kategori"}, self.category)
            self.assertEqual(get_article(conn, article)["category"], "Omdøbt kategori")
            save_category(conn, {"name": "Omdøbt kategori"}, self.category)
            with self.assertRaises(ValueError):
                delete_category(conn, self.category)
            save_category(conn, {"name": "Anden kategori"})
            other = conn.execute(
                "SELECT id FROM knowledge_categories WHERE name='Anden kategori'"
            ).fetchone()["id"]
            with self.assertRaises(ValueError):
                save_category(conn, {"name": "anden kategori"}, self.category)
            save_article(conn, dict(self.payload, category_id=other), article)
            delete_category(conn, self.category)
        database.initialize()
        with database.connect() as conn:
            self.assertIsNone(
                conn.execute(
                    "SELECT id FROM knowledge_categories WHERE id=?", (self.category,)
                ).fetchone()
            )
            self.assertEqual(get_article(conn, article)["category_id"], other)

    def test_deleting_article_preserves_sources_stock_and_other_articles(self):
        with database.connect() as conn:
            first = save_article(conn, self.payload)
            second = save_article(
                conn, dict(self.payload, title="En anden erfaring", status="published")
            )
            delete_article(conn, first)
            self.assertIsNone(get_article(conn, first))
            remaining_article = get_article(conn, second)
            self.assertEqual(remaining_article["sources"][0]["print_id"], self.print_id)
            self.assertTrue(remaining_article["tags"])
            self.assertIsNotNone(
                conn.execute(
                    "SELECT id FROM prints WHERE id=?", (self.print_id,)
                ).fetchone()
            )
            self.assertEqual(
                conn.execute(
                    "SELECT remaining FROM filaments WHERE id=?", (self.spool_id,)
                ).fetchone()["remaining"],
                990,
            )
            self.assertEqual(
                conn.execute(
                    "SELECT grams FROM consumption WHERE print_id=?", (self.print_id,)
                ).fetchone()["grams"],
                10,
            )
            delete_article(conn, second)
            undo_print(conn, self.print_id)
            self.assertEqual(
                conn.execute(
                    "SELECT remaining FROM filaments WHERE id=?", (self.spool_id,)
                ).fetchone()["remaining"],
                1000,
            )

    def test_article_delete_rolls_back_all_links_on_failure(self):
        with database.connect() as conn:
            identity = save_article(conn, self.payload)
            conn.execute(
                "CREATE TRIGGER fail_article_delete BEFORE DELETE ON knowledge_articles BEGIN SELECT RAISE(ABORT,'Test failure'); END"
            )
        with self.assertRaises(sqlite3.IntegrityError), database.connect() as conn:
            delete_article(conn, identity)
        with database.connect() as conn:
            article = get_article(conn, identity)
            self.assertTrue(article["tags"])
            self.assertEqual(article["sources"][0]["print_id"], self.print_id)

    def test_category_validation(self):
        with database.connect() as conn:
            save_category(conn, {"name": "Særlig kategori"})
            with self.assertRaises(ValueError):
                save_category(conn, {"name": "særlig kategori"})
            with self.assertRaises(ValueError):
                save_article(conn, dict(self.payload, category_id=999999))
            with self.assertRaises(ValueError):
                save_article(conn, dict(self.payload, tags=["x" * 101]))
