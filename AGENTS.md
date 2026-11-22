# Filament DB – agent guide

Applies to the entire repository. See [README.md](README.md) for an overview and topic guides in `docs/`.

## Documentation and language

- Track TODOs, planned work, and follow-up tasks as GitHub issues in this repository. Do not create or maintain a `TODO.md` file.

- Maintain all project documentation in English, including README, guides, plans, status files, GitHub issues, and this file. Use English filenames and headings for new documentation, and update links when moving or renaming files.
- Describe Filament DB as a localizable application. Do not describe it as a Danish-only application or require all user-facing text to be Danish. Interface language is independent of documentation language.
- Danish (`da`) is currently the default and fallback interface catalog. Preserve this runtime behavior unless explicitly asked to change it. Keep user-facing text in language files and maintain the default catalog when adding or changing messages.
- Preserve technical identifiers, API routes, stored values, commands, licenses, and existing user data when translating documentation. Use English descriptions of UI actions; actual labels follow the selected interface language.

## Architecture and files

- Personal filament inventory web application with a Dracula theme. The page title is `Filament DB`.
- `src/app.py`: small startup module for `python3 -m src.app`. Python 3.11+; SQLite uses only the standard library.
- `src/http_server.py`: HTTP responses, write routes, and the shared transaction boundary. `src/http_reads.py`: read routes, CSV, and static files.
- `src/database.py`: connections and repeatable SQLite migrations. `src/config.py`: paths and version. `src/mysql_backend.py`: MySQL adapter with the optional PyMySQL driver.
- `src/validation.py`: spool field validation. `src/filaments.py`, `src/locations.py`, `src/prints.py`, `src/waste.py`, and `src/consumption.py`: domain rules. Write functions use the HTTP layer's transaction and must not commit independently. See [deployment](docs/deployment.md), [MySQL](docs/mysql.md), and [backup](docs/backup.md) for operations guides.
- Frontend responsibilities are documented in [docs/architecture.md](docs/architecture.md): `core.js` (helpers), `inventory-data.js` (snapshots), `usage-model.js` (pure calculations), `inventory.js`, `dashboard.js`, `consumption.js`, `labels.js`, `prints.js`, and `locations.js`. `app.js` coordinates navigation and updates; `bootstrap.js` is the only `type="module"` script and starts the app through explicit imports. Modules must not use global application functions or export print drafts or QR selections. `actions.js` connects callbacks to the app coordinator without circular imports. `inventory-data.js` owns private snapshots with read-only public access. Projects use `PrintEditor.startProject(project)`; do not modify print drafts directly from other production files. New scripts must be allowed in `src/http_reads.py`.
- `static/index.html`, `static/app.js`, `static/style.css`: responsive plain HTML, JavaScript, and CSS without a build step or CDN dependencies. QR codes use the bundled MIT-licensed `static/vendor/qrcodegen.js`; preserve its license header.
- `tests/test_app.py`: API, persistence, and migration tests. `tests/test_deploy.py`: deployment tests with mocked Docker.
- `tests/mysql_integration.py`: explicit integration test against a new, disposable MySQL test database; never use production.
- `tests/material-overview.test.cjs`: frontend logic tested with Node's built-in test runner.
- `compose.mysql.yaml`: explicit MySQL production option; default startup still uses SQLite. Preserve the SQLite volume after switching, and use MySQL backups during active MySQL operation.
- `compose.yaml` and `Dockerfile`: the Python app only. Do not add an nginx service or container.
- [Nginx reverse proxy example](docs/deployment.md#nginx-reverse-proxy-example): generic HTTPS configuration for existing host nginx. Keep actual host configuration and certificates outside the repository.
- `src/deploy.py` and `VERSION`: deployment and version management.

## Development and verification

Use Ruff to verify all `.py` files after Python changes. Fix findings and check both lint and formatting:

```sh
ruff check .
ruff format --check .
```

If Ruff is not installed, use `uvx ruff` instead. Format with `ruff format .` and review automatic changes. Do not use `--unsafe-fixes` indiscriminately.

Run relevant tests after changes:

```sh
python3 -m unittest discover -s tests -v
for file in static/*.js; do node --check "$file"; done
node --experimental-vm-modules --test tests/*.test.cjs
```

For Docker Compose changes, run `docker compose config --quiet`. Do not run `src/deploy.py` merely to test code: it increments the version and recreates the running app. Report which checks were performed.

Agents must not perform visual browser checks. The user performs visual verification manually; continue running relevant automated tests and syntax checks.

Start locally with `python3 -m src.app` and open `http://127.0.0.1:49173`. Preserve port **49173**; if it changes, keep the app, Docker, healthcheck, nginx, and documentation consistent.

## Data and domain rules

- Local database: `data/filaments.sqlite3`; Docker: `/data/filaments.sqlite3` in the `filament-data` volume. Configuration: `HOST`, `PORT`, `DATABASE_PATH`.
- Preserve existing data. Schema changes must migrate automatically and be repeatable without data loss. Test with temporary databases, never the user's inventory.
- Use parameterized SQL and transactions for inventory changes. Validate on the server and escape user data when rendering HTML. Product links must use HTTP/HTTPS.
- One database row represents one roll. Quantity during creation creates separate rolls; weight, remaining weight, and price apply per roll.
- Weight is grams of filament excluding the empty spool; price is DKK. Remaining weight must be between zero and the original weight.
- Purchase format distinguishes with spool, refill, and unspecified. Refills are not physical spools; empty physical spools still count.
- Location cards open content selection per slot; Edit spool opens the individual form. `PUT /api/locations/{id}/contents` moves, replaces, or clears contents atomically and checks `expected_filament_id`. Preserve weight, identity, and history; archived spools cannot be assigned.
- Active spools have a unique active slot; an empty field means inventory. An empty spool releases its active slot.
- `label_token` is a permanent, server-generated identity for QR/deep links. Never copy or reuse it for new rolls; preserve it during edits and migrations.
- Add more copies product data but resets individual inventory status, notes, location, and opening date.
- Identical filaments are grouped visually only. Preserve individual editing and consumption recording. Apply filters before grouping cards.
- Material suggestions come only from the database. Import former HTML defaults once from `src/reference/material_types.json`; never re-add deleted unused defaults on restart. Protect names used by spools (including archived) or explicit project filament types from rename/delete. Preserve the array-of-names `GET /api/material-types` response; administration uses `?details=1`.
- The material overview sums the entire inventory per type, such as `PLA Basic` or `PETG Basic`, independently of card filters.
- `src/file_archive.py` stores original 3MF files in `data/files/` (Docker `/data/files/`) outside the database. `archive_files` stores metadata, notes, and custom per-plate estimates in `plate_estimates` (seconds/grams). Custom estimates apply to new project drafts; preserve the source file and existing projects. `projects.archive_file_id` links the project. Project uploads also archive the file; identical bytes are reused without overwriting notes. Deleting a project preserves its file; deleting a file unlinks projects and preserves their metadata/prints. Backups must include both database and file directory, including with MySQL.
- `src/three_mf.py` is a standalone, limited 3MF metadata reader. Import never extracts files to disk, executes contents, or fetches external resources. Do not guess unknown estimates. `src/projects.py` stores upcoming projects separately without inventory deductions; `static/projects.js` handles previews and the projects page.
- `src/build_plates.py` manages build plate types through `/api/build-plates`. Seed Textured PEI once; do not recreate deleted types on restart. `projects.build_plate_id` is optional and separate from the 3MF plate number. Types in use cannot be deleted; names must be unique regardless of case.
- Prints have their own optional `archive_file_id`, inherited from a project or selected manually. Preserve it during editing, Print again, and project deletion. File deletion clears both project and print links without changing consumption. The archive's `print_count` and latest date count records including pending and failed prints. The one-time migration may transfer only surviving project links and must not restore manually removed print links.
- Upcoming projects represent one selected print plate. `POST /api/prints` accepts `planned_project_id`; save inventory changes and the project's `print_id` atomically. Reject duplicate starts. Deleting a print resets its project link. Preserve original 3MF files outside the database; store only metadata and a JPEG thumbnail in the database. Nginx must allow uploads up to 30 MB (`client_max_body_size 32m`).
- Project prints use `POST /api/prints` in one transaction with one consumption line per selected spool. `DELETE /api/prints/{id}` restores all lines atomically. Project lines cannot be deleted individually; spools with project consumption must retain their identity until the entire print record is deleted. Existing individual consumption has `print_id = NULL`.
- Empty spools can be archived with `POST /api/filaments/{id}/archive`. Archiving preserves identity and history but releases active and physical locations. Archived spools do not count as physical inventory. Restoring assigns no automatic location. If an inventory change restores positive remaining weight, automatically restore the spool to current inventory through `sync_ams_slots` in the same transaction. Handle `archived` separately from form `FIELDS` and include it in CSV exports.
- Print time is stored as `prints.duration_minutes`: integer 1–1,000,000 or NULL for unknown. Statistics count time once per print by print date, including failed prints; unknown time is excluded from averages. Print again copies time; waste and individual consumption have no print time. Time changes must not change remaining weights.
- Waste uses `POST /api/waste`, one line per spool, and `waste_id` on consumption lines. Creation, editing, and deletion are atomic. Spools with waste history cannot be deleted; waste lines cannot be deleted individually. Optional `project_id` is only a print link; deleting the print removes the link but preserves waste. Existing consumption of failed prints counts as waste without additional deductions or double counting. Status changes do not change weights.
- Consumption is tied to a specific spool and deducted atomically from remaining weight. Deleting an incorrect record restores weight without exceeding the original weight. History is deleted with the spool.
- CSV is an export, not a complete backup. Use database backups to preserve inventory and consumption history.
- Never commit databases, credentials, or local runtime files. Do not delete Docker volumes or user data during routine development.

## User interface

- Language files live in `static/locales/da.json`, registered in `static/locales/index.json`. New UI text must have catalog keys and use `i18n.js` `t()`/`th()`/`tn()`; mark static HTML with `data-i18n-text` and attribute translation markers. Never use translated text as API codes or inventory keys. Do not translate user data or vendor code. API errors are localized by `src/i18n.py` at the response boundary.
- The lessons-learned area uses **Erfaringer** in the default catalog (formerly Knowledge). Preserve existing `knowledge` API routes and deep links when changing display names.
- Preserve the Dracula palette and mobile support.
- Navigation contains Dashboard, Inventory, Consumption, Upcoming projects, File archive, Lessons learned, Locations, and QR labels with consistent text size, icon width, and alignment; highlight the active tab. Administration stays at the bottom of the sidebar, outside the scrollable primary navigation, and owns browser-local language/printer settings plus shared material type, build plate, and lesson category management, along with read-only app version/database information. Preserve the legacy #build-plates link by redirecting it to #admin/build-plates. Category filters and article/project selectors remain in their respective workflows. Its printer-availability checkbox enables/disables the optional Bluetooth print actions; availability is separate from the actual Bluetooth connection. Locations and available slots share one page; creating/editing a location has its own card.
- Show the material type only in the card's top-left label, using purple text.
- Preserve transparent filament, product IDs, repurchase links, grouped cards with counts, and individual consumption history.
- Browser installation uses `static/manifest.webmanifest` and local PNG icons. Installed apps use browser-native controls; do not reintroduce a sidebar refresh toolbar. Preserve the Filament DB name, standalone display, and network-based data access without a service worker or offline cache.
- Show the version in the footer. Do not reintroduce the text “Dracula palette”.

## Deployment and versioning

- When the user asks to merge into `main`, ask whether VERSION should be bumped before merging. If the user has already specified the version or explicitly declined a bump for that merge, follow that decision without asking again.

- Explicitly inform the user of new or changed infrastructure requirements before implementation/deployment when a feature requires changes outside the app. This includes database grants, database/Docker versions, networking, ports, nginx, secrets, and external services. Describe the concrete change, reason, affected environment, and required user action; update the relevant `docs/` guide, README links, and any plan/status file. Do not assume app deployment changes host infrastructure.
- The MySQL app account needs `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `INDEX`, and `REFERENCES` on the app database. Knowledge foreign keys require `REFERENCES`, an extension to the original grants. Do not change grants automatically during routine development or deployment.
- Update with `python3 -m src.deploy`. The script requires Python on Linux/macOS and Docker Compose with `--wait`.
- The script locks deployment and validates Compose. By default it deploys the existing `VERSION` without rewriting it. Only an explicit `--bump build|minor|major` changes the version; minor and major reset following components. It builds and recreates the app and waits for its healthcheck.
- Image cleanup runs only with `--cleanup-images`; default deployment skips image lookups and cleanup. Healthcheck uses `start_interval: 1s`, `start_period: 30s`, then `interval: 30s` (Docker Engine 25+, Compose 2.20.2+).
- An explicitly requested version bump is reserved before building and retained after failure. An ordinary deployment never changes VERSION, including on failure. Do not roll back an explicitly reserved number automatically.
- `APP_VERSION` is embedded in the image; `/api/version` supplies it to the UI. Direct startup falls back to `VERSION`.
- Ordinary `docker compose` and container restarts do not increment the version. Preserve this distinction and document changes in [docs/deployment.md](docs/deployment.md).
- Publish the container port only at `127.0.0.1:49173`. Existing nginx on the same host handles HTTPS and proxies to this address; it must forward the original Host header.
- The app has no login. Avoid unintentionally increasing network exposure.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
