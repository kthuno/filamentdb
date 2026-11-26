# Manufacturer material profiles

[Back to README](../README.md) · [M220 labels](inventory-and-locations.md#phomemo-m220-labels)

## Source and coverage

The initial reference dataset is extracted from the user-supplied [Bambu Filament Guide](https://cms.bblmw.com/Bambu_Filament_Guide_77b0b697ca.pdf), retrieved on November 22, 2026. It contains 42 materials on PDF page 1. The downloaded PDF SHA-256 is `3556a92bc3785046d1b0be8b0a3682a7b7c9e2ea99bf485db74f5c41397b8714`.

The extraction covers nozzle temperature ranges, bed temperature ranges by plate, drying temperature/time ranges by method, and whether drying is required. It preserves both blast-oven and printer-heatbed drying conditions and method-specific qualifications. It does not import mechanical properties, annealing temperatures, cooling-fan percentages, or print speeds into label fields. The guide has no flow-ratio column; `flow_ratio` is NULL for every seeded profile. No values are taken from example labels or inferred from related materials. For example, this guide specifies PAHT-CF at 260-300 degrees Celsius for the nozzle, 100-120 degrees Celsius for Smooth/Textured PEI beds, and 80 degrees Celsius for 8-12 hours in a blast drying oven.

Coverage reflects this PDF rather than Bambu Lab's complete current product range. PETG HF is absent and remains unmatched. Hyphens, whitespace, and letter case are normalized for lookup, allowing `PAHT CF` to match `PAHT-CF`; variant markers such as `+` and `/` are retained. A generic `PLA` never matches `PLA Basic`. Manufacturer aliases are limited to Bambu, BambuLab, and Bambu Lab.

## Database and API

`material_profiles` is independent of inventory and is included in ordinary database backups. Its composite primary key is `(manufacturer_key, material_key)`.

| Columns | Meaning |
| --- | --- |
| `manufacturer`, `material` | Source display names |
| `nozzle_min_c`, `nozzle_max_c` | Nozzle temperature range in degrees Celsius |
| `bed_temperatures` | JSON array of plate names and inclusive Celsius ranges |
| `drying_conditions` | JSON array of method identifiers, Celsius/hour ranges, and conditions |
| `drying_required` | Whether the guide requires drying before use |
| `flow_ratio` | Optional calibrated ratio; NULL when not supplied by the source |
| `source_url`, `source_sha256`, `source_page`, `retrieved_on` | Provenance of the imported reference data |

`GET /api/material-profiles?manufacturer=Bambu%20Lab&material=PAHT%20CF` returns the matching profile, or JSON `null` if unmatched. Response temperatures use `[minimum, maximum]` arrays; a fixed value has identical bounds. This endpoint is read-only and never updates spool weights, stored temperatures, identities, or history. The label UI offers explicit plate/method selection and keeps saved spool values ahead of automatic suggestions.

At startup, repeatable migrations create the table in SQLite or MySQL and seed the local JSON snapshot once using migration marker `bambu_filament_guide_77b0b697ca_v1`. Existing reference rows are not overwritten; subsequent restarts preserve edited values and deleted rows. No PDF download, PDF parser, internet connection, or extra dependency is required at runtime. The snapshot is inside `src/`, so the existing Docker image includes it automatically. This uses the database privileges already required by the app; no new grants, services, ports, or host changes are required.

## Reproduce the extraction

The optional development script uses pdfplumber and never opens an application database:

```sh
curl -LfsS 'https://cms.bblmw.com/Bambu_Filament_Guide_77b0b697ca.pdf' -o /tmp/bambu-filament-guide.pdf
uv run --with pdfplumber python tools/import_bambu_guide.py /tmp/bambu-filament-guide.pdf /tmp/bambu-filament-guide.json
```

The importer verifies the reviewed PDF checksum, table dimensions, column headings, unique material count, and every relevant temperature/time cell. It rejects a changed PDF rather than silently importing a new layout. The committed snapshot is `src/reference/bambu_filament_guide.json`; compare the regenerated JSON with that file before replacing it. Original PDFs and generated databases must not be committed. A future guide revision needs source review and an explicit migration/update strategy to preserve user edits; replacing the JSON alone does not overwrite existing database rows.

Automated tests cover exact variant matching, unknown materials, NULL flow ratios, source provenance, method separation, repeated migration, preservation of spool records, API responses, and asynchronous label edits. Physical label and printer checks remain manual.

## Designer and print profiles

On **QR labels → Print via USB/Bluetooth**, select a spool and open its design.
The native label uses the exact manufacturer/material guide match when present;
unmatched materials and failed lookups retain saved spool temperatures. Missing
flow/drying values remain unknown. The default build plate is Textured PEI (or
the first available plate); drying uses the first listed condition. Edit label
content in the graphical designer without changing spool metadata.

The selected-spool template previews use the same profile defaults. Lookups
are lazy, cached by manufacturer/material and limited to four concurrent
requests. Search, material/manufacturer filters and 12-card pages apply to the
native spool overview, including archived rolls; they do not affect A4 selection.

The former Label images gallery, its separate guide-selection controls and its
SVG/browser-image print workflow have been removed. PNG/JSON export remains
available in the graphical print dialog. A4 labels remain a separate workflow.
