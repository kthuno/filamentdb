"""File bytes, notes, project references and disk/DB failure boundaries."""

import base64
import hashlib
import json
import struct
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from test_three_mf import package

from src import database, file_archive
from src.http_server import Handler


class FileArchiveTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(
            database, "DB", Path(self.directory.name) / "test.sqlite3"
        )
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.root_patch = patch.object(
            file_archive,
            "archive_root",
            return_value=Path(self.directory.name) / "files",
        )
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        database.initialize()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.content = package()

    def request(self, path, method="GET", data=None, headers=None):
        body = (
            data
            if isinstance(data, bytes)
            else json.dumps(data).encode()
            if data is not None
            else None
        )
        return urllib.request.urlopen(
            urllib.request.Request(
                self.url + path, data=body, method=method, headers=headers or {}
            )
        )

    def upload(self, path="/api/files", content=None, filename="Model æ.3mf"):
        with self.request(
            path,
            "POST",
            content or self.content,
            {"X-Filename": quote(filename), "Content-Type": "application/octet-stream"},
        ) as response:
            return json.load(response)

    def rejected(self, path, method="GET", data=None, status=400, headers=None):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(path, method, data, headers)
        self.assertEqual(error.exception.code, status)
        error.exception.close()

    def project_payload(self, draft, plate_index=0):
        plate = {
            k: v for k, v in draft["plates"][plate_index].items() if k != "thumbnail"
        }
        metadata = {
            k: v
            for k, v in draft.items()
            if k not in {"plates", "warnings", "name", "archive_file_id"}
        }
        return {
            "name": "Archived project",
            "note": "Project-specific note",
            "project_url": "",
            "image": "",
            "metadata": {**metadata, "plate": plate},
            "archive_file_id": draft["archive_file_id"],
        }

    def test_crud_download_deduplication_and_project_links(self):
        draft = self.upload(filename="../../Model æ.3mf")
        identity = draft["archive_file_id"]
        path = f"/api/files/{identity}"
        files = json.load(self.request("/api/files"))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["filename"], "Model æ.3mf")
        self.assertEqual(files[0]["size_bytes"], len(self.content))
        self.assertNotIn("storage_key", files[0])
        original = json.load(self.request(path))
        self.assertEqual(original["sha256"], hashlib.sha256(self.content).hexdigest())
        self.assertEqual(len(original["metadata"]["plates"]), 2)
        self.assertIsNone(original["metadata"]["plates"][1]["estimated_grams"])
        self.assertNotIn("thumbnail", original["metadata"]["plates"][0])
        self.request(path, "PUT", {"name": "My model", "note": "Use a brim\n<notes>"})
        # A repeated upload from projects reuses the file without replacing notes.
        imported = self.upload("/api/projects/import")
        self.assertEqual(imported["archive_file_id"], identity)
        self.assertEqual(len(json.load(self.request("/api/files"))), 1)
        updated = json.load(self.request(path))
        self.assertEqual(updated["note"], "Use a brim\n<notes>")
        self.assertEqual(updated["name"], "My model")
        with self.request(path + "/download") as response:
            self.assertEqual(response.read(), self.content)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertIn("attachment;", response.headers["Content-Disposition"])
            self.assertIn("Model%20%C3%A6.3mf", response.headers["Content-Disposition"])
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        preview = json.load(self.request(path + "/preview"))
        self.assertEqual(preview["name"], "My model")
        payload = self.project_payload(preview)
        self.request("/api/projects", "POST", payload)
        project = json.load(self.request("/api/projects"))[0]
        self.assertEqual(project["archive_file_id"], identity)
        project_path = f"/api/projects/{project['id']}"
        self.assertEqual(
            json.load(self.request(path))["projects"][0]["id"], project["id"]
        )
        # Legacy clients omitting the optional reference must preserve it on edits.
        legacy = dict(payload)
        legacy.pop("archive_file_id")
        self.request(project_path, "PUT", legacy)
        self.assertEqual(
            json.load(self.request(project_path))["archive_file_id"], identity
        )
        database.initialize()
        database.initialize()
        self.assertEqual(json.load(self.request(path))["note"], updated["note"])
        # Deleting a project must not delete its original file.
        self.request(project_path, "DELETE")
        self.assertEqual(self.request(path + "/download").read(), self.content)
        self.request("/api/projects", "POST", payload)
        project = json.load(self.request("/api/projects"))[0]
        self.request(path, "DELETE")
        kept = json.load(self.request(f"/api/projects/{project['id']}"))
        self.assertIsNone(kept["archive_file_id"])
        self.assertEqual(kept["metadata"], payload["metadata"])
        self.assertEqual(kept["note"], payload["note"])
        self.assertEqual(list(file_archive.archive_root().iterdir()), [])
        self.assertEqual(json.load(self.request("/api/files")), [])
        for suffix in ("", "/download", "/preview"):
            self.rejected(path + suffix, status=404)
        self.rejected(path, "PUT", {"name": "Missing", "note": ""}, 404)
        self.rejected(path, "DELETE", status=404)

    def print_fixture(self):
        draft = self.upload()
        with database.connect() as conn:
            spool = conn.execute(
                "INSERT INTO filaments (name,manufacturer,material,weight,remaining,label_token) VALUES ('PLA','Test','PLA',1000,1000,'archive-print-test')"
            ).lastrowid
        payload = {
            "name": "Print fra arkivet",
            "print_date": "2026-11-21",
            "note": "",
            "items": [{"filament_id": spool, "grams": 100}],
        }
        return draft, spool, payload

    def test_print_file_link_survives_project_deletion_repeat_and_file_deletion(self):
        draft, spool, payload = self.print_fixture()
        source = draft["archive_file_id"]
        path = f"/api/files/{source}"
        self.request("/api/projects", "POST", self.project_payload(draft))
        project = json.load(self.request("/api/projects"))[0]["id"]
        self.request("/api/prints", "POST", {**payload, "planned_project_id": project})
        first = json.load(self.request("/api/prints"))[0]["id"]
        self.assertEqual(
            json.load(self.request(f"/api/prints/{first}"))["archive_file_id"], source
        )
        self.request(f"/api/projects/{project}", "DELETE")
        self.request(f"/api/prints/{first}", "PUT", {**payload, "note": "Redigeret"})
        self.assertEqual(
            json.load(self.request(f"/api/prints/{first}"))["archive_file_id"], source
        )
        self.request(
            "/api/prints",
            "POST",
            {**payload, "archive_file_id": source, "status": "failed"},
        )
        second = json.load(self.request("/api/prints"))[0]["id"]
        summary = json.load(self.request("/api/files"))[0]
        self.assertEqual(summary["print_count"], 2)
        self.assertEqual(summary["last_print_date"], payload["print_date"])
        self.assertEqual(summary["project_count"], 0)
        self.assertEqual(
            {p["id"] for p in json.load(self.request(path))["prints"]}, {first, second}
        )
        self.request(f"/api/prints/{second}", "DELETE")
        self.assertEqual(json.load(self.request("/api/files"))[0]["print_count"], 1)
        with database.connect() as conn:
            before = conn.execute(
                "SELECT remaining FROM filaments WHERE id=?", (spool,)
            ).fetchone()["remaining"]
        self.request(path, "DELETE")
        self.assertIsNone(
            json.load(self.request(f"/api/prints/{first}"))["archive_file_id"]
        )
        with database.connect() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT remaining FROM filaments WHERE id=?", (spool,)
                ).fetchone()["remaining"],
                before,
            )
        self.request(f"/api/prints/{first}", "DELETE")
        with database.connect() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT remaining FROM filaments WHERE id=?", (spool,)
                ).fetchone()["remaining"],
                1000,
            )

    def test_file_reference_validation_is_atomic(self):
        draft, spool, payload = self.print_fixture()
        self.request("/api/projects", "POST", self.project_payload(draft))
        project = json.load(self.request("/api/projects"))[0]["id"]
        for source in (True, "1", 999999):
            self.rejected("/api/prints", "POST", {**payload, "archive_file_id": source})
        self.rejected(
            "/api/prints",
            "POST",
            {**payload, "planned_project_id": project, "archive_file_id": None},
        )
        self.rejected(
            "/api/prints",
            "POST",
            {
                **payload,
                "planned_project_id": project,
                "items": [{"filament_id": spool, "grams": 2000}],
            },
        )
        self.assertEqual(json.load(self.request("/api/prints")), [])
        self.assertIsNone(
            json.load(self.request(f"/api/projects/{project}"))["print_id"]
        )
        self.assertEqual(json.load(self.request("/api/files"))[0]["print_count"], 0)
        with database.connect() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT remaining FROM filaments WHERE id=?", (spool,)
                ).fetchone()["remaining"],
                1000,
            )

    def test_existing_project_links_migrate_once_without_overwriting_manual_unlink(
        self,
    ):
        draft, _spool, payload = self.print_fixture()
        self.request("/api/projects", "POST", self.project_payload(draft))
        project = json.load(self.request("/api/projects"))[0]["id"]
        self.request("/api/prints", "POST", {**payload, "planned_project_id": project})
        printing = json.load(self.request("/api/prints"))[0]["id"]
        with database.connect() as conn:
            conn.execute(
                "UPDATE prints SET archive_file_id=NULL WHERE id=?", (printing,)
            )
            conn.execute("DELETE FROM migrations WHERE name='print_archive_links'")
        database.initialize()
        database.initialize()
        self.assertEqual(
            json.load(self.request(f"/api/prints/{printing}"))["archive_file_id"],
            draft["archive_file_id"],
        )
        self.request(
            f"/api/prints/{printing}", "PUT", {**payload, "archive_file_id": None}
        )
        database.initialize()
        self.assertIsNone(
            json.load(self.request(f"/api/prints/{printing}"))["archive_file_id"]
        )
        self.assertEqual(json.load(self.request("/api/files"))[0]["print_count"], 0)

    @staticmethod
    def thumbnail_png(rgb):
        def chunk(kind, content):
            return (
                struct.pack(">I", len(content))
                + kind
                + content
                + struct.pack(">I", zlib.crc32(kind + content))
            )

        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00" + bytes(rgb)))
            + chunk(b"IEND", b"")
        )

    def test_original_thumbnails_are_served_per_plate_without_changing_file(self):
        first = self.thumbnail_png((255, 0, 0))
        second = self.thumbnail_png((0, 255, 0))
        content = package(
            extra={"Metadata/plate_1.png": first, "Metadata/plate_2.png": second}
        )
        source = self.upload(content=content)["archive_file_id"]
        path = f"/api/files/{source}"
        for suffix, expected in (
            ("/image", first),
            ("/image?plate=1", first),
            ("/image?plate=2", second),
        ):
            with self.request(path + suffix) as response:
                self.assertEqual(response.headers["Content-Type"], "image/png")
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(response.read(), expected)
        self.rejected(path + "/image?plate=unknown", status=404)
        self.rejected("/api/files/999999/image", status=404)
        self.assertEqual(self.request(path + "/download").read(), content)
        self.assertEqual(
            json.load(self.request(path))["sha256"], hashlib.sha256(content).hexdigest()
        )
        self.assertNotIn(
            "thumbnail", json.load(self.request(path))["metadata"]["plates"][0]
        )

    def test_linked_print_images_always_follow_file_instead_of_saved_photo(self):
        draft, _spool, payload = self.print_fixture()
        saved = b"\xff\xd8\xffold-photo\xff\xd9"
        payload["image"] = "data:image/jpeg;base64," + base64.b64encode(saved).decode()
        payload["archive_file_id"] = draft["archive_file_id"]
        self.request("/api/prints", "POST", payload)
        printing = json.load(self.request("/api/prints"))[0]["id"]
        image_path = f"/api/prints/{printing}/image"
        # A linked file without images must never fall back to the saved photo.
        self.rejected(image_path, status=404)
        first = self.thumbnail_png((255, 0, 0))
        second = self.thumbnail_png((0, 255, 0))
        source = self.upload(
            content=package(
                extra={"Metadata/plate_1.png": first, "Metadata/plate_2.png": second}
            )
        )["archive_file_id"]
        payload["archive_file_id"] = source
        self.request(f"/api/prints/{printing}", "PUT", payload)
        for suffix, expected in (("", first), ("?plate=2", second)):
            with self.request(image_path + suffix) as response:
                self.assertEqual(response.headers["Content-Type"], "image/png")
                self.assertEqual(response.read(), expected)
        # Source selection changes display, not the separately saved image.
        self.assertEqual(
            json.load(self.request(f"/api/prints/{printing}"))["image"],
            payload["image"],
        )
        self.request(f"/api/prints/{printing}", "PUT", {**payload, "image": ""})
        entry = next(
            row
            for row in json.load(self.request("/api/consumption"))
            if row["print_id"] == printing
        )
        self.assertEqual(entry["has_image"], 1)
        self.assertEqual(entry["archive_file_id"], source)
        self.assertEqual(self.request(image_path).read(), first)
        # Unlinked prints continue to use their own photos.
        self.request(
            f"/api/prints/{printing}", "PUT", {**payload, "archive_file_id": None}
        )
        with self.request(image_path) as response:
            self.assertEqual(response.headers["Content-Type"], "image/jpeg")
            self.assertEqual(response.read(), saved)

    def test_files_without_thumbnails_and_first_plate_without_image(self):
        source = self.upload()["archive_file_id"]
        self.rejected(f"/api/files/{source}/image", status=404)
        second = self.thumbnail_png((0, 0, 255))
        source = self.upload(content=package(extra={"Metadata/plate_2.png": second}))[
            "archive_file_id"
        ]
        self.assertEqual(self.request(f"/api/files/{source}/image").read(), second)
        self.rejected(f"/api/files/{source}/image?plate=1", status=404)
        self.assertEqual(
            self.request(f"/api/files/{source}/image?plate=2").read(), second
        )

    def test_validation_and_origin_rejections_leave_no_files(self):
        self.rejected(
            "/api/files", "POST", b"invalid", headers={"X-Filename": "bad.3mf"}
        )
        self.rejected(
            "/api/files", "POST", self.content, headers={"X-Filename": "bad.zip"}
        )
        self.rejected(
            "/api/files",
            "POST",
            self.content,
            403,
            {"Origin": "https://another-host", "X-Filename": "test.3mf"},
        )
        self.assertFalse(file_archive.archive_root().exists())
        self.assertEqual(json.load(self.request("/api/files")), [])
        draft = self.upload()
        path = f"/api/files/{draft['archive_file_id']}"
        for payload in (
            {"name": "", "note": ""},
            {"name": "Title", "note": "x" * 5001},
            {"name": "Title", "note": 5},
            {"name": "Title", "note": "", "storage_key": "../escape"},
        ):
            self.rejected(path, "PUT", payload)
        self.rejected(
            path,
            "PUT",
            {"name": "Title", "note": ""},
            403,
            {"Origin": "https://another-host"},
        )
        payload = self.project_payload(draft)
        self.rejected("/api/projects", "POST", dict(payload, archive_file_id=True))
        self.rejected("/api/projects", "POST", dict(payload, archive_file_id=999999))
        payload["metadata"]["sha256"] = "mismatch"
        self.rejected("/api/projects", "POST", payload)
        self.assertEqual(json.load(self.request("/api/projects")), [])
        self.assertEqual(self.request(path + "/download").read(), self.content)

    def test_saved_estimates_follow_each_plate_into_new_projects(self):
        draft = self.upload()
        path = f"/api/files/{draft['archive_file_id']}"
        estimates = {
            "1": {"estimated_seconds": 7200, "estimated_grams": 250},
            "2": {"estimated_seconds": 5400, "estimated_grams": 123.5},
        }
        payload = {
            "name": "My model",
            "note": "Estimates",
            "plate_estimates": estimates,
        }
        self.request(path, "PUT", payload)
        database.initialize()
        database.initialize()
        saved = json.load(self.request(path))
        self.assertEqual(saved["plate_estimates"], estimates)
        self.assertEqual(saved["metadata"]["plates"][0]["estimated_seconds"], 10481)
        self.assertEqual(saved["metadata"]["plates"][0]["estimated_grams"], 103.04)
        self.assertIsNone(saved["metadata"]["plates"][1]["estimated_grams"])
        preview = json.load(self.request(path + "/preview"))
        self.assertEqual(preview["plates"][0]["estimated_seconds"], 7200)
        self.assertEqual(preview["plates"][0]["estimated_grams"], 250)
        self.assertEqual(preview["plates"][1]["estimated_seconds"], 5400)
        self.assertEqual(preview["plates"][1]["estimated_grams"], 123.5)
        project_payload = self.project_payload(preview, plate_index=1)
        self.request("/api/projects", "POST", project_payload)
        project = json.load(self.request("/api/projects"))[0]
        self.assertEqual(project["metadata"]["plate"]["estimated_seconds"], 5400)
        self.assertEqual(project["metadata"]["plate"]["estimated_grams"], 123.5)
        self.assertEqual(self.request(path + "/download").read(), self.content)
        # Title/note-only clients preserve the saved estimates.
        self.request(path, "PUT", {"name": "Renamed", "note": "Kept"})
        imported = self.upload("/api/projects/import")
        self.assertEqual(imported["plates"][1]["estimated_grams"], 123.5)
        self.assertEqual(imported["archive_file_id"], draft["archive_file_id"])
        # Reset to source metadata, keeping already-created projects independent.
        self.request(path, "PUT", dict(payload, plate_estimates={}))
        reset = json.load(self.request(path + "/preview"))
        self.assertEqual(reset["plates"][0]["estimated_seconds"], 10481)
        self.assertIsNone(reset["plates"][1]["estimated_grams"])
        self.assertEqual(
            json.load(self.request(f"/api/projects/{project['id']}"))["metadata"],
            project["metadata"],
        )
        partial = {"1": {"estimated_seconds": None, "estimated_grams": 0}}
        self.request(path, "PUT", dict(payload, plate_estimates=partial))
        preview = json.load(self.request(path + "/preview"))
        self.assertEqual(preview["plates"][0]["estimated_seconds"], 10481)
        self.assertEqual(preview["plates"][0]["estimated_grams"], 0)

    def test_invalid_estimates_are_rejected_without_changing_archive_fields(self):
        draft = self.upload()
        path = f"/api/files/{draft['archive_file_id']}"
        before = json.load(self.request(path))
        invalid = [
            [],
            None,
            {"missing": {"estimated_seconds": 1, "estimated_grams": 1}},
            {"1": {}},
            {"1": {"estimated_seconds": 1, "estimated_grams": 1, "extra": 1}},
        ]
        invalid += [
            {"1": {"estimated_seconds": value, "estimated_grams": 1}}
            for value in (-1, 100000001, True, 1.5, "60")
        ]
        invalid += [
            {"1": {"estimated_seconds": 60, "estimated_grams": value}}
            for value in (-1, 1000001, True, "100", float("nan"), float("inf"))
        ]
        for estimates in invalid:
            with self.subTest(estimates=estimates):
                self.rejected(
                    path,
                    "PUT",
                    {
                        "name": "Must not save",
                        "note": "Changed",
                        "plate_estimates": estimates,
                    },
                )
        self.assertEqual(json.load(self.request(path)), before)

    def test_failed_upload_or_delete_rolls_back_disk_and_database(self):
        with patch("src.file_archive.os.fsync", side_effect=OSError("disk full")):
            self.rejected("/api/files", "POST", self.content, 500)
        self.assertEqual(json.load(self.request("/api/files")), [])
        self.assertEqual(list(file_archive.archive_root().iterdir()), [])
        original_upload = file_archive.upload_file

        def failing_upload(conn, content, filename, created):
            original_upload(conn, content, filename, created)
            raise ValueError("Aborted after writing file and metadata")

        with patch("src.http_server.upload_file", side_effect=failing_upload):
            self.rejected("/api/files", "POST", self.content)
        self.assertEqual(json.load(self.request("/api/files")), [])
        self.assertEqual(list(file_archive.archive_root().iterdir()), [])
        draft = self.upload()
        path = f"/api/files/{draft['archive_file_id']}"
        original_delete = file_archive.delete_file

        def failing_delete(conn, identity, deleted):
            original_delete(conn, identity, deleted)
            raise ValueError("Aborted deletion")

        with patch("src.http_server.delete_file", side_effect=failing_delete):
            self.rejected(path, "DELETE")
        self.assertEqual(self.request(path + "/download").read(), self.content)
        self.assertEqual(len(json.load(self.request("/api/files"))), 1)

    def test_concurrent_identical_uploads_share_one_original(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            uploads = list(
                pool.map(
                    lambda index: self.upload(filename=f"Copy {index}.3mf"), range(2)
                )
            )
        self.assertEqual(uploads[0]["archive_file_id"], uploads[1]["archive_file_id"])
        self.assertEqual(len(json.load(self.request("/api/files"))), 1)
        self.assertEqual(len(list(file_archive.archive_root().iterdir())), 1)

    def test_missing_original_is_reported_without_losing_notes(self):
        draft = self.upload()
        path = f"/api/files/{draft['archive_file_id']}"
        self.request(path, "PUT", {"name": "Keep notes", "note": "Preserved"})
        next(file_archive.archive_root().iterdir()).unlink()
        self.rejected(path + "/download", status=404)
        self.rejected(path + "/preview", status=404)
        self.assertEqual(json.load(self.request(path))["note"], "Preserved")

    def test_storage_keys_cannot_escape_and_different_content_is_separate(self):
        for key in ("../escape.3mf", "/tmp/escape.3mf", "0" * 32 + ".zip", None):
            with self.assertRaises(ValueError):
                file_archive.storage_path(key)
        first = self.upload()
        second = self.upload(content=package(extra={"Metadata/new.txt": "different"}))
        self.assertNotEqual(first["archive_file_id"], second["archive_file_id"])
        self.assertEqual(len(json.load(self.request("/api/files"))), 2)
        # Original bytes are served only by the dedicated download endpoint.
        with database.connect() as conn:
            key = conn.execute(
                "SELECT storage_key FROM archive_files WHERE id=?",
                (first["archive_file_id"],),
            ).fetchone()["storage_key"]
        self.rejected("/files/" + key, status=404)
        self.assertEqual(self.request("/files.js").status, 200)
