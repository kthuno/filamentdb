"""Read-only API endpoints, CSV export and an explicit static-file allowlist."""

import base64
import csv
import io
import json
import os
from contextlib import closing
from time import perf_counter
from urllib.parse import parse_qs, quote, urlparse

from .config import ROOT, VERSION
from .database import connect
from .file_archive import apply_estimates, get_file, storage_path
from .i18n import choose_language, locale_asset, translated_value
from .planning import planning_overview
from .three_mf import extract_3mf
from .validation import FIELDS


class ReadRoutes:
    def do_GET(self):
        path = urlparse(self.path).path
        if path in {
            "/api/knowledge",
            "/api/knowledge-categories",
            "/api/knowledge-tags",
        } or (
            len(path.strip("/").split("/")) == 3
            and path.startswith("/api/knowledge/")
            and path.rsplit("/", 1)[-1].isdigit()
        ):
            from .knowledge import get_article, list_articles

            try:
                with connect() as conn:
                    if path == "/api/knowledge-categories":
                        result = [
                            dict(row)
                            for row in conn.execute(
                                "SELECT c.*, (SELECT COUNT(*) FROM knowledge_articles a WHERE a.category_id=c.id) AS article_count FROM knowledge_categories c ORDER BY c.name"
                            )
                        ]
                    elif path == "/api/knowledge-tags":
                        result = [
                            dict(row)
                            for row in conn.execute(
                                "SELECT t.id,t.name,COUNT(atg.article_id) AS article_count FROM knowledge_tags t JOIN knowledge_article_tags atg ON atg.tag_id=t.id GROUP BY t.id,t.name ORDER BY t.name COLLATE NOCASE"
                            )
                        ]
                    elif path == "/api/knowledge":
                        result = list_articles(
                            conn, parse_qs(urlparse(self.path).query)
                        )
                    else:
                        result = get_article(conn, int(path.rsplit("/", 1)[-1]))
                        if result is None:
                            return self.respond(404, {"error": "Artiklen findes ikke."})
                return self.respond(200, result)
            except ValueError as error:
                return self.respond(400, {"error": str(error)})
        if path == "/api/planning":
            with connect() as conn:
                overview = planning_overview(conn)
            return self.respond(200, overview)
        if path == "/api/build-plates":
            with connect() as conn:
                rows = [
                    dict(row)
                    for row in conn.execute(
                        "SELECT * FROM build_plates ORDER BY name COLLATE NOCASE"
                    )
                ]
            return self.respond(200, rows)
        if path == "/api/material-types":
            from .materials import list_materials

            with connect() as conn:
                materials = list_materials(conn)
            details = parse_qs(urlparse(self.path).query).get("details") == ["1"]
            return self.respond(
                200, materials if details else [item["name"] for item in materials]
            )
        if path == "/api/material-profiles":
            from .material_profiles import lookup

            query = parse_qs(urlparse(self.path).query)
            with connect() as conn:
                profile = lookup(
                    conn,
                    query.get("manufacturer", [""])[0],
                    query.get("material", [""])[0],
                )
            return self.respond(200, profile)
        if path == "/api/locations":
            with connect() as conn:
                rows = [
                    dict(row)
                    for row in conn.execute(
                        "SELECT * FROM locations ORDER BY name COLLATE NOCASE"
                    )
                ]
            return self.respond(200, rows)
        if path == "/api/system-status":
            backend = os.environ.get("DATABASE_BACKEND", "sqlite")
            try:
                with closing(connect(readonly=True)) as conn:
                    started = perf_counter()
                    # An empty inventory is healthy too: successful execution is enough.
                    conn.execute("SELECT id FROM filaments LIMIT 1").fetchone()
                    response_ms = round((perf_counter() - started) * 1000, 2)
            except Exception as error:  # noqa: BLE001 - diagnostic boundary for both DB drivers
                # Never expose connection credentials, paths, or SQL error details.
                self.log_error("Database status unavailable (%s)", type(error).__name__)
                return self.respond(
                    503,
                    {
                        "database": backend,
                        "database_online": False,
                        "response_ms": None,
                    },
                )
            return self.respond(
                200,
                {
                    "database": backend,
                    "database_online": True,
                    "response_ms": response_ms,
                },
            )
        if path == "/api/version":
            return self.respond(
                200,
                {
                    "version": VERSION,
                    "database": os.environ.get("DATABASE_BACKEND", "sqlite"),
                },
            )
        parts = path.strip("/").split("/")
        if path == "/api/files":
            with connect() as conn:
                rows = [
                    dict(row)
                    for row in conn.execute(
                        """SELECT f.id,f.name,f.note,f.filename,f.sha256,f.size_bytes,f.created_at,f.updated_at,
                    (SELECT COUNT(*) FROM projects p WHERE p.archive_file_id=f.id) AS project_count,
                    (SELECT COUNT(*) FROM prints pr WHERE pr.archive_file_id=f.id) AS print_count,
                    (SELECT MAX(pr.print_date) FROM prints pr WHERE pr.archive_file_id=f.id) AS last_print_date
                    FROM archive_files f ORDER BY f.id DESC"""
                    )
                ]
            return self.respond(200, rows)
        if (
            len(parts) in (3, 4)
            and parts[:2] == ["api", "files"]
            and parts[2].isdigit()
        ):
            with connect() as conn:
                result = get_file(conn, int(parts[2]))
                if result is None:
                    return self.respond(404, {"error": "Filen findes ikke længere."})
                if len(parts) == 3:
                    return self.respond(200, result)
                if parts[3] not in {"download", "preview", "image"}:
                    return self.respond(404, {"error": "Ikke fundet"})
                row = conn.execute(
                    "SELECT storage_key FROM archive_files WHERE id=?", (int(parts[2]),)
                ).fetchone()
                try:
                    content = storage_path(row["storage_key"]).read_bytes()
                except FileNotFoundError:
                    return self.respond(
                        404,
                        {
                            "error": "Originalfilen mangler på serveren. Gendan den fra backup."
                        },
                    )
                except OSError:
                    return self.respond(
                        500, {"error": "Originalfilen kunne ikke læses."}
                    )
            if parts[3] == "download":
                return self.respond(
                    200,
                    content,
                    "application/octet-stream",
                    {
                        "Content-Disposition": "attachment; filename=\"model.3mf\"; filename*=UTF-8''"
                        + quote(result["filename"], safe=""),
                    },
                )
            try:
                draft = extract_3mf(content, result["filename"])
            except (ValueError, TypeError):
                return self.respond(
                    400, {"error": "Arkivfilen kunne ikke læses som 3MF."}
                )
            if parts[3] == "image":
                plate_id = parse_qs(urlparse(self.path).query).get("plate", [None])[0]
                thumbnail = next(
                    (
                        plate["thumbnail"]
                        for plate in draft["plates"]
                        if plate["thumbnail"]
                        and (plate_id is None or plate["id"] == plate_id)
                    ),
                    "",
                )
                if not thumbnail:
                    return self.respond(
                        404, {"error": "Filen har intet billede til denne printplade."}
                    )
                kind, encoded = thumbnail.split(",", 1)
                return self.respond(
                    200,
                    base64.b64decode(encoded),
                    kind.removeprefix("data:").removesuffix(";base64"),
                )
            draft.update(archive_file_id=result["id"], name=result["name"])
            apply_estimates(draft, result["plate_estimates"])
            return self.respond(200, draft)
        if path == "/api/projects":
            with connect() as conn:
                rows = [
                    dict(row)
                    for row in conn.execute(
                        "SELECT p.id,p.name,p.note,p.project_url,p.metadata,p.print_id,p.created_at,p.build_plate_id,p.filament_types,p.archive_file_id,pr.status AS print_status,b.name AS build_plate_name, CASE WHEN p.image<>'' THEN 1 ELSE 0 END AS has_image FROM projects p LEFT JOIN build_plates b ON b.id=p.build_plate_id LEFT JOIN prints pr ON pr.id=p.print_id ORDER BY p.id DESC"
                    )
                ]
            for row in rows:
                row["metadata"] = json.loads(row["metadata"])
                row["filament_types"] = json.loads(row["filament_types"])
            return self.respond(200, rows)
        if (
            len(parts) in (3, 4)
            and parts[:2] == ["api", "projects"]
            and parts[2].isdigit()
        ):
            with connect() as conn:
                row = conn.execute(
                    "SELECT p.*,b.name AS build_plate_name FROM projects p LEFT JOIN build_plates b ON b.id=p.build_plate_id WHERE p.id=?",
                    (int(parts[2]),),
                ).fetchone()
            if not row:
                return self.respond(404, {"error": "Projektet findes ikke længere."})
            if len(parts) == 4:
                if parts[3] != "image" or not row["image"]:
                    return self.respond(404, {"error": "Billedet findes ikke."})
                return self.respond(
                    200, base64.b64decode(row["image"].split(",", 1)[1]), "image/jpeg"
                )
            result = dict(row)
            result["metadata"] = json.loads(result["metadata"])
            result["filament_types"] = json.loads(result["filament_types"])
            return self.respond(200, result)
        if path == "/api/prints":
            with connect() as conn:
                rows = [
                    dict(row)
                    for row in conn.execute(
                        "SELECT id, name, print_date, status FROM prints ORDER BY id DESC"
                    )
                ]
            return self.respond(200, rows)
        if len(parts) == 3 and parts[:2] == ["api", "waste"] and parts[2].isdigit():
            with connect() as conn:
                row = conn.execute(
                    "SELECT * FROM waste WHERE id=?", (int(parts[2]),)
                ).fetchone()
                if not row:
                    return self.respond(
                        404, {"error": "Spildregistreringen findes ikke længere."}
                    )
                result = dict(row)
                result["items"] = [
                    dict(item)
                    for item in conn.execute(
                        "SELECT filament_id, grams FROM consumption WHERE waste_id=? ORDER BY id",
                        (int(parts[2]),),
                    )
                ]
            return self.respond(200, result)
        if len(parts) == 3 and parts[:2] == ["api", "prints"] and parts[2].isdigit():
            with connect() as conn:
                row = conn.execute(
                    "SELECT * FROM prints WHERE id=?", (int(parts[2]),)
                ).fetchone()
                if not row:
                    return self.respond(404, {"error": "Printet findes ikke længere."})
                result = dict(row)
                result["items"] = [
                    dict(item)
                    for item in conn.execute(
                        "SELECT filament_id, grams FROM consumption WHERE print_id=? ORDER BY id",
                        (int(parts[2]),),
                    )
                ]
            return self.respond(200, result)
        if (
            len(parts) == 4
            and parts[:2] == ["api", "prints"]
            and parts[2].isdigit()
            and parts[3] == "image"
        ):
            with connect() as conn:
                row = conn.execute(
                    "SELECT image,archive_file_id FROM prints WHERE id=?",
                    (int(parts[2]),),
                ).fetchone()
            if row and row["archive_file_id"] is not None:
                target = f"/api/files/{row['archive_file_id']}/image"
                plate = parse_qs(urlparse(self.path).query).get("plate", [None])[0]
                if plate is not None:
                    target += "?plate=" + quote(plate, safe="")
                return self.respond(302, b"", headers={"Location": target})
            if not row or not row["image"]:
                return self.respond(404, {"error": "Billedet findes ikke."})
            return self.respond(
                200, base64.b64decode(row["image"].split(",", 1)[1]), "image/jpeg"
            )
        if path == "/api/consumption":
            with connect() as conn:
                rows = [
                    dict(row)
                    for row in conn.execute("""SELECT c.*, f.name, f.material, f.manufacturer, f.color
                    , p.name AS project_name, p.print_date, p.note AS project_note, p.project_url, p.status AS print_status, p.duration_minutes, p.archive_file_id
                    , w.waste_date, w.reason AS waste_reason, w.note AS waste_note, w.project_id AS linked_project_id, wp.name AS linked_project_name
                    , CASE WHEN p.archive_file_id IS NOT NULL OR p.image<>'' THEN 1 ELSE 0 END AS has_image
                    FROM consumption c JOIN filaments f ON f.id=c.filament_id
                    LEFT JOIN prints p ON p.id=c.print_id
                    LEFT JOIN waste w ON w.id=c.waste_id
                    LEFT JOIN prints wp ON wp.id=w.project_id ORDER BY c.id DESC""")
                ]
            return self.respond(200, rows)
        if (
            len(parts) == 4
            and parts[:2] == ["api", "filaments"]
            and parts[2].isdigit()
            and parts[3] == "consumption"
        ):
            with connect() as conn:
                if not conn.execute(
                    "SELECT id FROM filaments WHERE id=?", (int(parts[2]),)
                ).fetchone():
                    return self.respond(404, {"error": "Spolen findes ikke længere."})
                rows = [
                    dict(row)
                    for row in conn.execute(
                        """SELECT c.*, p.print_date, w.waste_date FROM consumption c
                        LEFT JOIN prints p ON p.id=c.print_id
                        LEFT JOIN waste w ON w.id=c.waste_id
                        WHERE c.filament_id=? ORDER BY c.id DESC""",
                        (int(parts[2]),),
                    )
                ]
            return self.respond(200, rows)
        if path in ("/api/filaments", "/api/export"):
            with connect() as conn:
                rows = [
                    dict(row)
                    for row in conn.execute("SELECT * FROM filaments ORDER BY id DESC")
                ]
            if path == "/api/export":
                output = io.StringIO()
                writer = csv.DictWriter(
                    output,
                    fieldnames=["id"]
                    + sorted(FIELDS)
                    + ["label_token", "created_at", "archived"],
                )
                writer.writeheader()
                for row in rows:
                    writer.writerow(
                        {
                            key: (
                                "'" + value
                                if isinstance(value, str)
                                and value.startswith(("=", "+", "-", "@", "\t", "\r"))
                                else value
                            )
                            for key, value in row.items()
                        }
                    )
                return self.respond(
                    200,
                    ("\ufeff" + output.getvalue()).encode(),
                    "text/csv; charset=utf-8",
                )
            return self.respond(200, rows)
        if path == "/manifest.webmanifest":
            manifest = json.loads(
                (ROOT / "static" / "manifest.webmanifest").read_text()
            )
            requested = parse_qs(urlparse(self.path).query).get("lang", ["da"])[0]
            language = choose_language(requested)
            manifest["lang"] = language
            manifest["description"] = translated_value(
                "app.description", language, manifest["description"]
            )
            if language != "da":
                manifest["start_url"] = "/?lang=" + quote(language, safe="")
            return self.respond(
                200,
                json.dumps(manifest, ensure_ascii=False).encode(),
                "application/manifest+json; charset=utf-8",
            )
        if path.startswith("/locales/") and path.endswith(".json"):
            name = path[len("/locales/") : -len(".json")]
            try:
                asset = locale_asset(name)
            except (OSError, ValueError, KeyError, TypeError):
                return self.respond(500, {"error": "Sprogfilen kunne ikke læses."})
            if asset is not None and asset.is_file():
                return self.respond(
                    200, asset.read_bytes(), "application/json; charset=utf-8"
                )
            return self.respond(404, {"error": "Ikke fundet"})
        assets = {
            "/i18n.js": ("i18n.js", "text/javascript; charset=utf-8"),
            "/actions.js": ("actions.js", "text/javascript; charset=utf-8"),
            "/core.js": ("core.js", "text/javascript; charset=utf-8"),
            "/inventory-data.js": (
                "inventory-data.js",
                "text/javascript; charset=utf-8",
            ),
            "/usage-model.js": ("usage-model.js", "text/javascript; charset=utf-8"),
            "/inventory.js": ("inventory.js", "text/javascript; charset=utf-8"),
            "/dashboard.js": ("dashboard.js", "text/javascript; charset=utf-8"),
            "/consumption.js": ("consumption.js", "text/javascript; charset=utf-8"),
            "/labels.js": ("labels.js", "text/javascript; charset=utf-8"),
            "/thermal-labels.js": (
                "thermal-labels.js",
                "text/javascript; charset=utf-8",
            ),
            "/m220-bluetooth.js": (
                "m220-bluetooth.js",
                "text/javascript; charset=utf-8",
            ),
            "/administration.js": (
                "administration.js",
                "text/javascript; charset=utf-8",
            ),
            "/m220-printing.js": ("m220-printing.js", "text/javascript; charset=utf-8"),
            "/vendor/bambu-lab-logo.js": (
                "vendor/bambu-lab-logo.js",
                "text/javascript; charset=utf-8",
            ),
            "/prints.js": ("prints.js", "text/javascript; charset=utf-8"),
            "/locations.js": ("locations.js", "text/javascript; charset=utf-8"),
            "/bootstrap.js": ("bootstrap.js", "text/javascript; charset=utf-8"),
            "/files.js": ("files.js", "text/javascript; charset=utf-8"),
            "/knowledge.js": ("knowledge.js", "text/javascript; charset=utf-8"),
            "/": ("index.html", "text/html; charset=utf-8"),
            "/manifest.webmanifest": (
                "manifest.webmanifest",
                "application/manifest+json; charset=utf-8",
            ),
            "/projects.js": ("projects.js", "text/javascript; charset=utf-8"),
            "/install.js": ("install.js", "text/javascript; charset=utf-8"),
            "/icons/app-180.png": ("icons/app-180.png", "image/png"),
            "/icons/app-192.png": ("icons/app-192.png", "image/png"),
            "/icons/app-512.png": ("icons/app-512.png", "image/png"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
            "/favicon.svg": ("favicon.svg", "image/svg+xml"),
            "/vendor/qrcodegen.js": (
                "vendor/qrcodegen.js",
                "text/javascript; charset=utf-8",
            ),
        }
        if path not in assets:
            return self.respond(404, {"error": "Ikke fundet"})
        filename, mime = assets[path]
        self.respond(200, (ROOT / "static" / filename).read_bytes(), mime)
