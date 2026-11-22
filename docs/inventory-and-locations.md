# Inventory, locations, and QR labels

[Back to README](../README.md)

- [Inventory and material overview](#inventory-and-material-overview)
- [Material types and AMS HT](#material-types-and-ams-ht)
- [Locations](#locations)
- [Quick recording and spool labels](#quick-recording-and-spool-labels)
- [Print QR labels](#print-qr-labels)
- [Phomemo M220 labels](#phomemo-m220-labels)
- [Archive spools](#archive-spools)

## Inventory and material overview

- Create, edit, and delete individual filaments. During creation, choose a quantity (1–100) to create multiple identical rolls. Weight, remaining weight, and price are per roll. Each spool can then be edited separately and counts in the inventory overview.
- Record purchases with a spool or as refills. The overview shows total rolls, physical spools, and refills. Physical spools count purchases with a spool even when empty; refills do not count as physical spools. Each record represents one purchase/roll.
- Existing records migrate to unspecified purchase format so you can choose it yourself. They count as physical spools only after selecting with spool. Purchase format is included in CSV exports.
- Optional HTTP/HTTPS product links provide a repurchase link on the card, opening in a new tab. Links are included in CSV and copied when adding more rolls.
- Optional product IDs (SKU or EAN) appear on cards and are searchable. Multiple spools may share a product ID. Existing records receive an empty ID during migration.
- Opacity can be opaque or transparent, including colored transparent filament. Transparency appears on cards, is searchable, included in CSV, and copied when adding rolls. Existing records default to opaque.
- Store manufacturer, material type, color, diameter, purchase date, and opening date.
- Store original filament weight and remaining weight in grams, excluding the empty spool, plus price in DKK and physical location.
- Store nozzle/bed temperatures and notes for print profiles and drying; zero means unspecified.
- Click a spool card to edit. A grouped card opens its spool list; click an individual row to edit it. Enter/Space also work when the card or row has keyboard focus. Buttons and links retain their own actions.
- Identical filaments are grouped visually on one card with a count and total remaining weight. Grouping matches name, manufacturer, material, product ID/link, color, transparency, diameter, original weight, and purchase format. Remaining weight, location, and purchase date may differ; each spool remains individually editable. Filters apply before grouping, so cards count only visible spools. Database rows are never merged.
- Use text search, material/inventory filters, and sorting.
- Dashboard is the start page with inventory totals, active spools, consumption statistics, and shortcuts to prints, projects, files, and lessons learned. Inventory shows the collection and material overview; Consumption shows history and recording actions. Direct links to pages and spools are preserved.
- The material overview shows total remaining kg/grams and counts of stocked/empty rolls per type, independently of search and filters. Enter types such as `PLA Basic` or `PETG Matte` to distinguish variants. Grouping ignores case and extra spaces and combines colors/manufacturers. Both spools and refills count as rolls. Existing `PLA` records remain in the PLA group until assigned a variant.
- Low-stock indicators mark rolls below 20%, excluding empty rolls.
- CSV exports can be opened in Excel. They are not database backups.

Printers and AMS devices are not connected automatically. Temperatures and material properties are entered manually; the app does not check printer compatibility.

## Material types and AMS HT

New material types are saved automatically to a persistent catalog when saving a spool and suggested in the material/type field later. Existing types are imported during migration; deleting spools does not remove types. AMS HT has one spool slot, the same graphical presentation as AMS 2 Pro, and an automatic active slot while filament remains. SQLite and MySQL migrations require no additional infrastructure privileges.

## Locations

Use **Locations** in the sidebar to create, view, edit, and delete locations. Creation/editing has its own card; available slots and the location overview share one page. **Build plates** and **QR labels** have separate navigation links; the old Administration page is removed. Legacy `#admin` links redirect to Locations. A dry box and AMS HT have one slot; AMS 2 Pro has four numbered slots. Names are case-insensitively unique.

When adding/editing filament, choose a defined location and slot or enter a manual location. Each defined slot supports only one spool, including concurrent saves. Empty spools retain their physical location until moved or deleted. Multiple new rolls start without a defined location and are placed individually. Assigning an AMS 2 Pro slot automatically makes it the spool's active slot and hides its separate active-slot field. Moving away from AMS 2 Pro removes that derived active slot. Boxes, AMS HT, and manual locations can still have a separate active printer slot.

A four-slot AMS 2 Pro is created automatically during the first migration if none exists. It is seeded only once, respecting later deletion.

Renaming updates linked spool locations and AMS 2 Pro active-slot names. Occupied locations cannot be deleted; reducing four slots to one requires slots 2–4 to be free. Existing manual locations survive migration. Free-text locations are not capacity-managed.

Choose location ascending in inventory sorting to show individual spools in location order, with numeric sorting and unplaced spools last. Other sort orders still group identical filaments visually.

Click a location card to choose its contents. AMS slots can be selected directly; clicking elsewhere on the card opens the first free slot or slot 1. The dialog searches current inventory and offers **No spool · clear slot**. **Edit spool** opens the occupant's full form without leaving Locations.

**Save contents** moves the selected spool from its previous location and returns any previous occupant to inventory. Weight, QR identity, notes, and consumption history are preserved. AMS activation still follows remaining weight. `PUT /api/locations/{id}/contents` saves `slot`, `filament_id`, and `expected_filament_id` within the HTTP layer's shared transaction. Changed contents are rejected so a stale dialog cannot overwrite newer choices. No new database fields or infrastructure requirements apply.

API: `GET/POST /api/locations` and `PUT/DELETE /api/locations/{id}`. Locations have `name` and `kind` (`box`, `ams_ht`, `ams_2_pro`). Spools link through `location_id` and `location_slot`; both are `null` for manual locations. Database backups preserve locations and links; CSV remains an export only.

## Quick recording and spool labels

- **Add more:** Reuse product information from an existing card. Enter quantity, price per roll, and purchase date. Remaining weight starts at the original filament weight. Opening date, notes, location, and active slot are not copied.
- **Active spools:** Edit a spool and choose an AMS 2 Pro location/slot, or enter another active printer slot, such as an external spool. An empty field means inventory. Each active slot has one occupant; clear the old spool's active slot before replacing it. Multiple rolls cannot be created in one active slot. An exhausted spool leaves active slots automatically but retains its physical location; restored weight reactivates its AMS 2 Pro slot automatically.
- **Quick consumption:** Use an active spool's button or **Record consumption** above the inventory. Active spools appear first. The browser remembers the last-used spool and suggests it if filament remains; otherwise it suggests an active spool. The grams field receives focus and Enter saves. Enter slicer grams including any waste you want counted.
- **QR and direct links:** Choose QR label for an individual spool, under its roll in a grouped card. Copy its link or print the label. Scanning opens consumption recording for that spool; nothing is recorded before submission. Labels use permanent random IDs that are never reused after deletion. Existing spools receive IDs automatically at startup.

Open the app through its permanent network address, such as `https://filament.example.com`, before creating labels. Your phone must reach the address and trust its DNS/HTTPS setup. Links created on `localhost` work only on the device opening them. Reprint labels after changing domains. QR generation is local and sends no data to external services.

The bundled QR generator comes from [Project Nayuki](https://www.nayuki.io/page/qr-code-generator-library), retrieved on 2026-11-08. Source and MIT license are in `static/vendor/qrcodegen.js`; preserve them when distributing. No package installation or JavaScript build is required.

## Print QR labels

**QR labels → Show all QR labels** generates the overview directly on the page without a dialog. It shows one label per spool, including empty spools, sorted by location. Each uses the same name, manufacturer, material type, color, product ID, and permanent QR link as its individual label. Checkboxes control printing. All are initially selected; use **Select all** or **Deselect all** for bulk selection. **Print selected labels** prints only selected labels, up to nine framed labels per A4 page (3 × 3), without gaps from deselected labels. Printing is disabled if none are selected. Use portrait A4 at 100% scale with browser headers/footers disabled. Open the permanent network address before printing.

## Phomemo M220 labels

Open **QR label** for an individual spool and select **M220 · Extended** or **M220 · Compact**. Both formats use black and white only and retain the permanent QR link to consumption recording for that particular roll. Scanning never records consumption automatically. The existing **Classic label** and bulk A4 label sheets remain available.

Choose the paper size as **width × height**: 40 × 30 mm, 60 × 40 mm, or 70 × 80 mm. The default is 60 × 40 mm. All three sizes support both layouts. The extended format contains the manufacturer logo/name, material, color with product ID, hexadecimal color code, nozzle/bed temperatures, flow ratio, drying information, and QR code. The compact format contains the logo/name, QR code, material, color with product ID, and hexadecimal color code. The hexadecimal code is printed as text, never as a color swatch.

Only Bambu Lab has a bundled logo; manufacturer names `Bambu Lab`, `BambuLab`, and `Bambu` are recognized without case sensitivity. Other manufacturers appear as text. Temperatures start from saved spool values, with zero treated as unknown. For an exact match among the 42 materials in the bundled [Bambu guide lookup](material-profiles.md), empty fields receive reference temperatures and drying conditions. Saved spool values and edits made while the lookup is loading take precedence. **Use guide values** explicitly replaces temperatures and drying instructions with the selected reference values. These label-only overrides are not saved to inventory and reset when opening a spool. Missing information appears as an em dash.

Choose the guide build plate and drying method in the dialog. Textured PEI and blast drying oven are initially selected when available; the guide also includes separate conditions for drying on the printer heatbed. Switching a plate or method replaces its associated label field, and relevant drying-method notes appear below the selectors. The profile does not infer a plate from a print project. The PDF contains no flow ratios: enter a calibrated value manually. Materials absent from this particular guide, such as PETG HF, receive no substitute profile. Generic PLA is not silently treated as PLA Basic. Other manufacturers and unavailable lookups retain manual label generation.

Choose **PNG image (203 dpi)** for Print Master, or **SVG vector** for other printing software, then **Download label**. PNG dimensions match the chosen size at the M220's 203 dpi: 320 × 240, 480 × 320, or 559 × 639 pixels. PNG exports are opaque black and white. Import the entire image into Print Master, set the matching label dimensions and orientation, and avoid cropping or stretching. Browser printing is also available using the selected physical page size; disable headers/footers and use 100% scale. Printer drivers and browser print settings can override page size, so PNG import is the preferred phone workflow. The app does not connect to the printer over Bluetooth.

Both thermal layouts use a circular top-left QR finder and square finders in the other two corners. All data modules use whole printer dots and retain a four-module white quiet zone. The extended layout places the color in the information column to give the QR code more space. Small formats display a warning when modules are only two dots wide; exceptionally long URLs disable export until a larger size or compact layout is selected. Use the permanent phone-reachable app address before generating labels. Test a physical label with your phone before printing a batch; actual M220 output and scanning must be verified manually by the user.

The M220 resolution is documented on [Phomemo's product page](https://phomemo.com/en-gb/products/m220-label-maker). Label generation is local and requires no external service or infrastructure changes.

### Logo attribution

The bundled Bambu Lab logo artwork is by **Lwde**, from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:BambuLab_logo.svg), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The adaptation rearranges the artwork horizontally and uses a black fill for thermal printing; the adapted logo artwork is distributed under the same license in `static/vendor/bambu-lab-logo.js`. SVG exports include this credit in their metadata. When sharing PNG labels, retain this attribution with the shared files. Bambu Lab remains a trademark of its respective owner; the logo identifies the spool manufacturer.

## Archive spools

Open an empty spool and choose **Archive spool** in the edit dialog. Archiving uses saved data; unsaved form changes are not saved. Only spools with zero grams remaining can be archived. Archiving releases active and defined/manual physical locations. The spool no longer counts toward current rolls, physical spools, refills, or empty rolls in the material overview. Filters do not change current inventory totals in that overview.

The archive filter offers **Current inventory** (default), **Archived spools**, and **All including archived**. Current and archived spools are never grouped together. Open an archived spool and choose **Restore spool** to return it without a location. Identity, QR link, and history are preserved; the QR link can be used to restore it. The combined QR sheet includes all spools, including archived ones.

If editing/deleting consumption restores weight to an archived spool, it returns to current inventory automatically in the same transaction. Its former location is not reused. Archived spools remain in consumption history, statistics, and database backups. CSV includes all spools and `archived` (0 or 1), but is still not a complete backup.

API: `POST /api/filaments/{id}/archive` with `{"archived": true}` or `{"archived": false}`. Change archive status through this endpoint, not the ordinary spool form. Existing spools migrate to current inventory without weight changes.

## See also

- [Prints and consumption](prints-and-consumption.md)
- [Backup](backup.md)
