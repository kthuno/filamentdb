"""HTTP transport, mutation routing and transaction boundaries."""

import json
import sqlite3
from contextlib import closing
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

from .build_plates import save_build_plate
from .consumption import register_consumption, undo_consumption
from .database import connect
from .filaments import archive_filament, save_filament
from .file_archive import delete_file, update_file, upload_file
from .http_reads import ReadRoutes
from .i18n import localize_response
from .knowledge_ai import AIError, generate_suggestion, source_context
from .locations import assign_location_content, save_location, sync_ams_slots
from .planning import save_wish
from .prints import register_print, undo_print
from .projects import save_project
from .three_mf import MAX_UPLOAD
from .waste import register_waste, undo_waste


class Handler(ReadRoutes, BaseHTTPRequestHandler):
    """Keep request parsing and responses separate from inventory domain rules."""

    def respond(
        self, status, body, content_type="application/json; charset=utf-8", headers=None
    ):
        if not isinstance(body, bytes):
            body = localize_response(body, self.headers.get("Accept-Language", ""))
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, limit=64000):
        """Bound the body before reading; print images have a separate larger limit."""
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= limit:
            raise ValueError("Formularen er for stor eller tom.")
        return json.loads(self.rfile.read(length))

    def mutation_route(self):
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) < 2 or parts[0] != "api":
            return None
        resource = parts[1]
        if (
            len(parts) == 4
            and resource == "prints"
            and parts[2].isdigit()
            and parts[3] == "knowledge-suggestion"
            and self.command == "POST"
        ):
            return "knowledge_suggestion", int(parts[2])
        if (
            resource == "locations"
            and len(parts) == 4
            and parts[2].isdigit()
            and parts[3] == "contents"
            and self.command == "PUT"
        ):
            return "location_contents", int(parts[2])
        if resource == "knowledge-categories" and (
            (len(parts) == 2 and self.command == "POST")
            or (
                len(parts) == 3
                and parts[2].isdigit()
                and self.command in {"PUT", "DELETE"}
            )
        ):
            return "knowledge_categories", int(parts[2]) if len(parts) == 3 else None
        if resource == "knowledge":
            if len(parts) == 2 and self.command == "POST":
                return "knowledge", None
            if (
                len(parts) == 3
                and parts[2].isdigit()
                and self.command in {"PUT", "DELETE"}
            ):
                return "knowledge", int(parts[2])
            if (
                len(parts) == 4
                and parts[2].isdigit()
                and parts[3] in {"publish", "archive"}
                and self.command == "POST"
            ):
                return "knowledge_" + parts[3], int(parts[2])
        if resource in {"build-plates", "shopping-wishes"} and (
            (len(parts) == 2 and self.command == "POST")
            or (
                len(parts) == 3
                and parts[2].isdigit()
                and self.command in {"PUT", "DELETE"}
            )
        ):
            identity = int(parts[2]) if len(parts) == 3 else None
            return resource.replace("-", "_"), identity
        if parts == ["api", "projects", "import"] and self.command == "POST":
            return "project_import", None
        if resource == "files" and (
            (len(parts) == 2 and self.command == "POST")
            or (
                len(parts) == 3
                and parts[2].isdigit()
                and self.command in {"PUT", "DELETE"}
            )
        ):
            return "archive_files", int(parts[2]) if len(parts) == 3 else None
        if (
            len(parts) == 2
            and self.command == "POST"
            and resource in {"filaments", "locations", "prints", "waste", "projects"}
        ):
            return resource, None
        if len(parts) == 3 and parts[2].isdigit():
            if resource in {
                "filaments",
                "locations",
                "prints",
                "waste",
                "projects",
            } and self.command in {
                "PUT",
                "DELETE",
            }:
                return resource, int(parts[2])
            if resource == "consumption" and self.command == "DELETE":
                return resource, int(parts[2])
        if (
            len(parts) == 4
            and resource == "filaments"
            and parts[2].isdigit()
            and parts[3] == "archive"
            and self.command == "POST"
        ):
            return "archive", int(parts[2])
        if (
            len(parts) == 4
            and resource == "filaments"
            and parts[2].isdigit()
            and parts[3] == "consumption"
            and self.command == "POST"
        ):
            return "spool_consumption", int(parts[2])
        return None

    def mutate(self):
        route = self.mutation_route()
        if route is None:
            return self.respond(404, {"error": "Ikke fundet"})
        # Compare the original Host header, including its port, to reject cross-origin writes.
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            return self.respond(403, {"error": "Ugyldig oprindelse"})
        resource, identity = route
        self.archive_created = []
        self.archive_deleted = []
        committed = False
        try:
            if resource == "knowledge_suggestion":
                # Finish and close the read connection before any external request.
                with closing(connect()) as conn:
                    context, categories = source_context(conn, identity)
                suggestion, cached = generate_suggestion(context, categories)
                return self.respond(
                    200,
                    {
                        "suggestion": suggestion,
                        "cached": cached,
                        "source": {
                            "print_id": identity,
                            "name": context["name"],
                            "note": context["note"],
                        },
                    },
                )
            if resource == "project_import" or (
                resource == "archive_files" and self.command == "POST"
            ):
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_UPLOAD:
                    raise ValueError("Vælg en 3MF-fil på højst 30 MB.")
                from urllib.parse import unquote

                content = self.rfile.read(length)
                if len(content) != length:
                    raise ValueError("Uploaden blev afbrudt. Prøv igen.")
                with connect() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    archive_id, result = upload_file(
                        conn,
                        content,
                        unquote(self.headers.get("X-Filename", "projekt.3mf")),
                        self.archive_created,
                    )
                committed = True
                result["archive_file_id"] = archive_id
                return self.respond(
                    200 if resource == "project_import" else 201, result
                )
            with connect() as conn:
                # SQLite serializes writers here; the MySQL adapter locks its shared lock row.
                # Domain helpers must not commit: stock, history and AMS slots succeed together.
                conn.execute("BEGIN IMMEDIATE")
                status = self.apply_mutation(conn, resource, identity)
                if status is None:
                    return
                sync_ams_slots(conn)
            committed = True
            for path in self.archive_deleted:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    self.log_error(
                        "Kunne ikke fjerne den slettede arkivfil: %s", path.name
                    )
            # Respond only after the connection context has committed successfully.
            self.respond(status, {"ok": True})
        except AIError as error:
            self.respond(error.status, {"error": str(error)})
        except sqlite3.IntegrityError as error:
            if "locations.name" in str(error):
                message = "Der findes allerede en placering med det navn."
            elif "filaments.location_id" in str(error):
                message = "Placeringens slot er allerede optaget. Vælg en ledig plads."
            else:
                message = "Den aktive plads er allerede optaget. Flyt først den anden spole til lager."
            self.respond(400, {"error": message})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.respond(400, {"error": str(error)})
        except OSError:
            self.respond(
                500,
                {
                    "error": "Filarkivet kunne ikke skrives. Kontrollér lagerplads og adgang til filmappen."
                },
            )
        finally:
            if not committed:
                for path in self.archive_created:
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        self.log_error(
                            "Kunne ikke rydde en afbrudt upload: %s", path.name
                        )

    def apply_mutation(self, conn, resource, identity):
        """Dispatch one write within the transaction, returning its success status."""
        if resource.startswith("knowledge"):
            from .knowledge import (
                delete_article,
                delete_category,
                get_article,
                save_article,
                save_category,
            )

            if resource == "knowledge_categories":
                if (
                    identity is not None
                    and not conn.execute(
                        "SELECT id FROM knowledge_categories WHERE id=?", (identity,)
                    ).fetchone()
                ):
                    self.respond(404, {"error": "Kategorien findes ikke længere."})
                    return None
                if self.command == "DELETE":
                    delete_category(conn, identity)
                else:
                    save_category(conn, self.read_json(), identity)
            else:
                if identity is not None and get_article(conn, identity) is None:
                    self.respond(404, {"error": "Artiklen findes ikke længere."})
                    return None
                if self.command == "DELETE":
                    delete_article(conn, identity)
                    return 200
                if resource in {"knowledge_publish", "knowledge_archive"}:
                    payload = get_article(conn, identity)
                    payload["status"] = (
                        "published" if resource == "knowledge_publish" else "archived"
                    )
                else:
                    payload = self.read_json(250000)
                save_article(conn, payload, identity)
            return 201 if identity is None else 200
        if resource == "location_contents":
            assign_location_content(conn, identity, self.read_json())
            return 200
        table = (
            "filaments" if resource in {"spool_consumption", "archive"} else resource
        )
        if identity is not None:
            # Table names come only from mutation_route's allowlist; user values are parameters.
            entry = conn.execute(
                f"SELECT * FROM {table} WHERE id=?", (identity,)
            ).fetchone()
            if entry is None:
                messages = {
                    "filaments": "Spolen",
                    "locations": "Placeringen",
                    "prints": "Printet",
                    "consumption": "Forbruget",
                    "waste": "Spildregistreringen",
                    "projects": "Projektet",
                    "build_plates": "Byggepladen",
                    "shopping_wishes": "Indkøbsønsket",
                    "archive_files": "Filen",
                }
                self.respond(404, {"error": f"{messages[table]} findes ikke længere."})
                return None
        if resource == "archive_files":
            if self.command == "DELETE":
                delete_file(conn, identity, self.archive_deleted)
            else:
                update_file(conn, identity, self.read_json())
        elif resource == "shopping_wishes":
            if self.command == "DELETE":
                conn.execute("DELETE FROM shopping_wishes WHERE id=?", (identity,))
            else:
                save_wish(conn, self.read_json(), identity)
        elif resource == "build_plates":
            if self.command == "DELETE":
                if conn.execute(
                    "SELECT id FROM projects WHERE build_plate_id=?", (identity,)
                ).fetchone():
                    raise ValueError(
                        "Byggepladen bruges af et projekt. Skift projektets plade først."
                    )
                conn.execute("DELETE FROM build_plates WHERE id=?", (identity,))
            else:
                save_build_plate(conn, self.read_json(), identity)
        elif resource == "projects":
            if self.command == "DELETE":
                # Planning records own no consumption: deleting one must never undo its print.
                conn.execute("DELETE FROM projects WHERE id=?", (identity,))
            else:
                save_project(conn, self.read_json(800000), identity)
        elif resource == "archive":
            archive_filament(conn, identity, self.read_json())
        elif resource == "locations":
            if self.command == "DELETE":
                if conn.execute(
                    "SELECT id FROM filaments WHERE location_id=?", (identity,)
                ).fetchone():
                    raise ValueError("Flyt spolerne, før placeringen slettes.")
                conn.execute("DELETE FROM locations WHERE id=?", (identity,))
            else:
                save_location(conn, self.read_json(), identity)
        elif resource == "prints":
            if self.command == "DELETE":
                undo_print(conn, identity)
            else:
                register_print(conn, self.read_json(800000), identity)
        elif resource == "waste":
            if self.command == "DELETE":
                undo_waste(conn, identity)
            else:
                register_waste(conn, self.read_json(), identity)
        elif resource == "consumption":
            undo_consumption(conn, entry)
        elif resource == "spool_consumption":
            register_consumption(conn, identity, self.read_json())
        elif self.command == "DELETE":
            # Keep spool identity as long as a project still refers to it.
            if conn.execute(
                "SELECT id FROM consumption WHERE filament_id=? AND (print_id IS NOT NULL OR waste_id IS NOT NULL)",
                (identity,),
            ).fetchone():
                raise ValueError(
                    "Spolen indgår i et registreret print eller spild. Slet registreringen før spolen slettes."
                )
            conn.execute("DELETE FROM consumption WHERE filament_id=?", (identity,))
            conn.execute("DELETE FROM filaments WHERE id=?", (identity,))
        else:
            save_filament(conn, self.read_json(), identity)
        return 201 if self.command == "POST" else 200

    do_POST = mutate
    do_PUT = mutate
    do_DELETE = mutate
