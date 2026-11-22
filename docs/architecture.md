# Architecture and code structure

[Back to README](../README.md)

`src/app.py` starts the server and runs migrations before the first request. Modules are divided by responsibility:

| Module | Responsibility |
|---|---|
| `config.py` | Project paths, default database path, and version |
| `database.py` | Database connections and repeatable SQLite migrations |
| `mysql_backend.py` | MySQL adapter and migrations |
| `http_server.py` | HTTP responses, write routes, and transactions |
| `http_reads.py` | Read routes, CSV exports, and static files |
| `i18n.py` | Language files, language selection, and API error translation |
| `validation.py` | Allowed spool fields and server-side validation |
| `filaments.py` | Creating and editing individual spools |
| `locations.py` | Locations, capacity, and active AMS slots |
| `prints.py` | Prints, images, and combined project consumption |
| `consumption.py` | Individual consumption and restoration |

The HTTP layer owns the transaction for inventory changes. Domain functions receive the connection and never commit independently, so inventory, history, and derived AMS slots are saved together.

The frontend uses JavaScript ES modules with explicit imports/exports, without TypeScript, a build step, or new package dependencies. HTML loads only `bootstrap.js` with `type="module"`; the browser follows relative imports. Importing feature modules does not start network requests or register UI handlers. `bootstrap.js` starts the app, which connects actions and initializes each feature.

| Frontend file | Responsibility |
|---|---|
| `core.js` | Shared DOM, formatting, URL, and HTTP helpers |
| `i18n.js` | Language catalogs, translation, locale, and language selector |
| `actions.js` | Coordinator callbacks without imports back into the app |
| `inventory-data.js` | Shared inventory and consumption snapshots; fetching without rendering |
| `usage-model.js` | Pure calculations, grouping, filtering, and sorting of consumption |
| `inventory.js` | Inventory cards, material overview, filters, and spool form |
| `dashboard.js` | Inventory overview, active spools, and statistics |
| `consumption.js` | Individual consumption, history, and history filters |
| `labels.js` | QR labels, selection, and printing |
| `thermal-labels.js` | Monochrome M220 SVG layouts, integer-dot QR placement, and PNG export |
| `m220-bluetooth.js`, `m220-printing.js` | Optional M220 raster protocol, browser Bluetooth session, and isolated print UI; see [setup and removal](m220-bluetooth.md) |
| `prints.js` | Shared draft and dialog for prints/waste; `PrintEditor` is the entry point for other features |
| `locations.js` | Locations, available capacity, and spool location fields |
| `projects.js`, `files.js`, `knowledge.js` | Projects/planning, file archive, and lessons learned |
| `app.js`, `bootstrap.js` | Navigation, shared updates, and startup |

Manufacturer reference data is separate from spool records: `src/material_profiles.py` creates and seeds `material_profiles` for SQLite and MySQL using the reviewed snapshot in `src/reference/bambu_filament_guide.json`. The read-only `/api/material-profiles` endpoint performs exact normalized manufacturer/material lookup. Label dialogs load reference values on demand and ignore responses from previously opened spools. See [material profiles](material-profiles.md) for provenance, migration behavior, and the offline import workflow.

Each module has its own scope. Inventory and consumption snapshots are private in `inventory-data.js`, exposed through read-only getters with frozen API data; only data fetching replaces snapshots. Print drafts and QR selections are not exported. Projects, the file archive, and lessons learned use `PrintEditor` to open prints. `actions.js` receives coordinator callbacks at startup, letting features request updates without importing `app.js` back. The import graph has no circular dependencies. New JavaScript files must be added to the HTTP layer's explicit static-file allowlist. `static/package.json` enables ES modules for Node tests and requires no npm installation.

Frontend tests use Node's module loader and isolated DOM fixtures. `--experimental-vm-modules` is needed only for test fixtures; browser and Python/Docker operation need no extra settings. Existing regression tests get test-internal access to private bindings without adding test APIs to production files. Separate isolation tests load modules without this access and check private state, imports, deep links, and startup.

## See also

- [Development and testing](development.md)
- [Language files](localization.md)

The Administration route (`#admin`) owns browser-local language/printer settings and shared build plate/category management, and remains below the scrollable primary navigation. Its printer-availability checkbox shows or hides Bluetooth print actions and is independent of actual Bluetooth connection status. Label generation remains on the QR labels page, with a link to Administration for printer setup.

The `#build-plates` route redirects to `#admin/build-plates`; `#admin/categories` opens category management. Administration loads build plate and category data independently so a failure in one does not prevent the other sections from working. `loadKnowledgeCategories()` refreshes both the article filters and the management list without fetching article/print records; category mutation errors are shown in Administration. The lessons overview retains read-only category counts and filter buttons, and article/project dialogs retain their category/build plate selectors.

`administration.js` owns material type management and the read-only version/database information display. Material mutations refresh suggestions through the application coordinator. The underlying `src/materials.py` retains the existing name-based catalog, imports former HTML defaults once, and protects types used by inventory or explicit project material selections. Both SQLite and MySQL use the existing schema. Administration and the footer app-version display share `/api/version`; the database-type field describes the configured backend rather than the database-server version. Refreshing this information changes no data and reveals no connection details or credentials.

Administration presents six always-visible cards grouped into overview, printer settings, and shared lists. Language and version/database information share a row on wide screens and stack on narrow screens. Cards use normal section headers without accordion controls. Shortcut routes (`#admin/language`, `#admin/printer`, `#admin/build-plates`, `#admin/materials`, `#admin/categories`, and `#admin/info`) scroll to their target card without changing form values. Browser-local preferences and shared data are labelled separately.

Administration checks database readability through the read-only `/api/system-status` endpoint on entering Administration and when refreshing information. The green/red indicator and SELECT duration are inside the database-type card. For SQLite the labels describe whether the database file can be read, rather than a server being online. SQLite probes open the existing file in read-only mode and never create a missing file or directory. The fixed `SELECT id FROM filaments LIMIT 1` is healthy even when it returns no row. Its duration in milliseconds measures only execution/fetch, excluding connection setup and close time or browser network latency. Failed probes return HTTP 503 without connection details or SQL error text. The last-check time is displayed; this is a checked snapshot, not continuous monitoring. Version information stays independent of database readability. Statistics are not collected or displayed. No migrations, grants, additional services, or deployment changes are required.
