# Projects, build plates, and shopping

[Back to README](../README.md)

- [Upcoming projects and 3MF import](#upcoming-projects-and-3mf-import)
- [Build plates](#build-plates)
- [Filament requirements and shopping list](#filament-requirements-and-shopping-list)

## Upcoming projects and 3MF import

Use **File archive → Create project** to create upcoming projects from archived Bambu Studio files. Uploads take place only in the file archive. The separate reader `src/three_mf.py` returns title, designer, license, slicer, printer profile, layer height, infill, configured filaments, and print plates. Saved slicing estimates provide time/consumption per plate and filament when available. Geometry is not sliced; missing estimates remain unspecified. Configured filament profiles are shown separately and are not necessarily used on the plate.

Create a project from an archive file to open its preview; no upcoming project exists until saved. Choose one plate, check its thumbnail/metadata, and edit name, note, project link, and estimates before **Save upcoming project**. A saved project represents the selected plate. Create additional projects from the same archive file for other plates. Project metadata and a downscaled JPEG thumbnail are stored in the database. The original file remains unchanged outside the database, linked through the archive. Cancelling preserves the archived file. Designer/license values come from the file and do not verify rights or origin.

Import and planning do not change inventory, history, or statistics. **Record print** opens a new pending print with today's date, name, note, link, thumbnail, and any estimated time. Gram estimates become consumption lines where you select actual inventory spools. With one filament, the project's total grams are used if available; with several, per-filament estimates are used without automatically distributing the total. Differences between total and lines are flagged. A total-only estimate creates one line. Unknown quantities remain empty and must be entered. Check grams before saving; file filament numbers are not spool IDs.

Inventory changes only on **Save print**, saving the full record and project link atomically. The same upcoming project cannot be recorded twice. Its card then shows **Open print**. Saving the print as completed asks whether to delete the linked project. Deletion preserves print, consumption, and history. Declining keeps the project for later deletion. A project can also be deleted manually with confirmation regardless of print status. Only planning data is removed; the print, weights, and history remain. Deleting the print restores weights and makes the project upcoming again if the project still exists.

API: `POST /api/projects/import` receives raw 3MF bytes and optional URL-encoded `X-Filename`, returns a preview with `archive_file_id`, and archives the original simultaneously. `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/{id}`, and `GET /api/projects/{id}/image` manage saved projects. `planned_project_id` on `POST /api/prints` links a print to an upcoming project. Import reads only limited XML/JSON metadata and embedded PNG/JPEG thumbnails; it never extracts contents to disk or fetches external resources.

**Nginx:** the [reverse proxy example](deployment.md#nginx-reverse-proxy-example) sets `client_max_body_size 32m`. Add the same setting to existing nginx and validate/reload it if uploads fail with HTTP 413. Container deployment does not change external nginx. Metadata/thumbnails are included in SQLite/MySQL backups. Originals require backing up the file directory too; see [File archive](file-archive.md) and [Backup](backup.md). Upcoming projects are not included in inventory CSV exports.

## Build plates

Under **Build plates**, create, rename, and delete plate types. **Textured PEI** is seeded once during migration. Names are case-insensitively unique. Deleted defaults are not recreated on restart.

Upcoming projects also have an optional **Filament type(s)** field. Enter values such as `PLA Basic, PETG HF`, comma-separated. They appear on cards and as a reference during recording but do not select actual spools or change inventory. Up to 20 types are saved, with case-insensitive duplicates removed. This planned material selection is separate from configured 3MF profiles and calculated consumption. API field `filament_types` is a string list.

A project's optional **Build plate** selection is independent of the numbered plate in the 3MF file. New projects default to Textured PEI if present; existing projects are not changed automatically. The choice appears on cards and during recording. Types in use cannot be deleted; renaming updates their project display name. The choice does not change inventory or slicer settings.

API: `GET/POST /api/build-plates` and `PUT/DELETE /api/build-plates/{id}` with `name`. Projects store optional `build_plate_id`, validated on the server and preserved in backups.

## Filament requirements and shopping list

**Upcoming projects** shows combined requirements and a shopping list. Open **View / edit** and select a filament product for each line. Without filament lines, select one product for the total estimate. Choices are saved per selected plate without reserving or deducting filament.

Products match by name, manufacturer, material type, product ID/link, color, transparency, diameter, roll size, and purchase format, like inventory card grouping. Remaining weight is summed across all current rolls in each group, independently of inventory filters and locations. Archived rolls do not contribute. Choices remain as snapshots even if the last roll is deleted; reselect a product if its inventory details change.

Requirements are summed across projects without a print record, subtracting inventory only once per product. One filament uses the total estimate if available; multiple filaments use line grams without automatic distribution. Unknown estimates and missing product choices are shown separately and excluded from known gram totals. Differences between total and known lines are flagged. The overview also flags sufficient combined stock when no individual roll has enough, requiring spool changes. This calculates quantities, not automatic print/spool allocation.

**Project shortages** shows missing grams and repurchase links. **Manual shopping wishes** can be created, edited, and removed with a name, optional quantity, link, and note. These are independent of calculated shortages and do not change inventory; record purchases as new rolls and then remove the wish. The overview loads when opening projects and can be recalculated with **Refresh**.

API: `GET /api/planning` returns products, combined needs, missing product choices, estimate differences, and manual wishes. `POST /api/shopping-wishes` and `PUT/DELETE /api/shopping-wishes/{id}` manage wishes using `name`, `grams` (number or NULL), `product_url`, and `note`. Choices are saved in `metadata.plate.material_choices` as product snapshots or NULL in filament-line order (one entry for total-only estimates). SQLite and MySQL migrate automatically; wishes and choices are backed up with the database, not CSV.

Projects have **Number of print plates** (1–1000, default 1). Enter grams/time for one selected plate; quantity multiplies requirements, shortages, and estimates for **Record print**. The form immediately shows total grams. Base estimates are preserved so changing quantity does not multiply previous totals again. Unknown estimates remain unknown. Quantity is stored as `metadata.plate.quantity`; older projects default to 1 without a schema change.

## See also

- [File archive](file-archive.md)
- [Prints and consumption](prints-and-consumption.md)
