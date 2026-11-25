# Size-specific label templates

[Back to README](../README.md) · [Native printing](native-printing.md)

Use **QR labels → Label templates → Show template settings** to import one
Phomymo-compatible JSON template for each supported size. Templates are used
in **Print via USB/Bluetooth → Open print and design**. The existing Label
images and A4 workflows keep their own layouts.

| Label size (width × height) | Native raster | Complete example |
|---|---|---|
| 40 × 30 mm | 320 × 240 dots | [40 × 30 template](examples/label-template-40x30.json) |
| 60 × 40 mm | 480 × 320 dots | [60 × 40 template](examples/label-template-60x40.json) |
| 70 × 80 mm | 560 × 640 dots | [70 × 80 template](examples/label-template-70x80.json) |

Coordinates, dimensions and font sizes use printer dots at exactly 8 dots/mm.
The M220 is nominally 203 DPI. Width and height are not interchangeable.

## Configure and use a template

1. Download an example from the corresponding size card, or use a supported
   Phomymo v3 design JSON as a starting point.
2. Edit the design and insert the variables below. Keep `labelSize` as numeric
   millimetres and positions/dimensions as numeric printer dots.
3. Import the JSON under its matching size. A size mismatch or unsupported
   content is rejected before replacing a saved template.
4. Open a spool in Print via USB/Bluetooth and choose that size. The template
   is instantiated with the spool's data and current label-profile values.
5. Edit the individual label if needed, then preview, export or print it.

**Export template** downloads the original JSON with its variable expressions.
**Export JSON** inside the print editor downloads the instantiated design with
concrete values. To keep a reusable template, retain the unresolved expressions
in the template settings or its exported template file.

Templates are stored in the application's database, shared by all clients and
included in database backups. Startup creates the `label_templates` table
repeatably on SQLite and MySQL using existing schema privileges; no additional
infrastructure or database grants are required. Individual spool edits and the
preferred size remain browser-local and are outside database backups.

Choose or search for a spool in template settings to preview all three sizes
with its current data and permanent QR link. Previews use the same renderer and
monochrome conversion as the print editor; an unconfigured size shows the built-in
layout. These previews do not include browser-local individual design overrides.

Existing browser-local templates are retained. **Transfer browser template to
database** explicitly copies a legacy template into an empty shared size slot;
it cannot overwrite an existing shared template. The original local copy remains
available through **Export browser template**. Import JSON to deliberately replace
a shared template. **Reload templates** fetches changes made by another client.
Revision checks reject stale replacements/deletions instead of overwriting newer
changes; reload and review the current template before trying again.
Importing/removing one size does not modify the other two sizes or inventory.

When no size is explicitly requested, the editor uses the last selected size.
Without that preference, it picks a configured size in the order 70 × 80,
60 × 40, 40 × 30, otherwise the built-in 70 × 80 default. A size with no custom
configuration uses the built-in spool design.

Each size has an independent working draft in the editor. Switching sizes
selects that size's template/default or its current draft; it does not stretch
one template into another format. **Apply template** resets the selected size
from its configured template and current spool data. Without a custom template,
this action is named **Spool design**.

Saved individual overrides belong to a spool and size. They are restored while
the corresponding template revision is unchanged. Unedited variable fields
refresh with current data, such as remaining weight, when reopening a spool;
manual replacements of those fields remain overrides. Replacing a template
applies the new layout on the next opening. Earlier saved designs are retained
in browser storage, but do not override a newly imported template. Templates
are never changed by editing or printing an individual spool label.

## Variable syntax

Use exact lowercase names surrounded by dollar signs, for example:

```json
{
  "text": "$filamenttype$ · $filamentcolorname$ ($filamentcolor$)",
  "color": "black"
}
```

A text element can mix literal text and multiple variables. Variables may be
used in root `name`, and in element `text`, `qrData`, `color`, `background`,
`fill` and `stroke`. Strings remain valid JSON strings; quote them normally.

Do not put variables in element IDs, `type`, coordinates, dimensions, font
sizes, image data or other properties. Unknown variable names are rejected.
Names are case-sensitive. There are no expressions, conditions, JavaScript,
external lookups or recursive substitutions. Dollar expressions that occur in
spool data are printed literally rather than evaluated again.

For spool consumption QR labels, use:

```json
{
  "id": "qr",
  "type": "qr",
  "x": 192,
  "y": 112,
  "width": 112,
  "height": 112,
  "rotation": 0,
  "qrData": "$qrurl$",
  "finderStyle": "round-top-left"
}
```

`$qrurl$` uses the selected spool's permanent link. A fixed `qrData` value is
retained literally and will not follow the selected spool. Open the app at
its permanent reachable address before generating labels.

## Available variables

| Variable | Value |
|---|---|
| `$spoolid$` | Numeric spool ID, e.g. 42. |
| `$spoolnumber$` | Spool ID padded to at least four digits, e.g. 0042. |
| `$filamentname$` | Spool name. |
| `$filamenttype$` | Stored material type, e.g. PLA Matte. |
| `$manufacturer$` | Manufacturer name. |
| `$filamentcolor$` | Color as RGB hex, e.g. #0000FF. Black if the stored code is missing or invalid. |
| `$filamentcolorrgb$` | Color as rgb(0, 0, 255). Black if the stored code is missing or invalid. |
| `$filamentcolorname$` | Color name, e.g. Blue. |
| `$productid$` | Product ID or empty text. |
| `$producturl$` | Product URL or empty text. Text only; does not fetch external content. |
| `$diameter$` | Filament diameter in mm without units, e.g. 1.75. |
| `$weight$` | Original filament weight in grams without units. |
| `$remainingweight$` | Remaining filament weight in grams without units. |
| `$location$` | Spool location or empty text. |
| `$activeslot$` | Active printer/AMS slot or empty text. |
| `$notes$` | Spool notes or empty text. |
| `$nozzletemperature$` | Current label-profile nozzle value, otherwise spool temperature with °C. — if unknown. |
| `$bedtemperature$` | Current label-profile bed value, otherwise spool temperature with °C. — if unknown. |
| `$flowratio$` | Current label-profile flow ratio. — if unknown. |
| `$drying$` | Current label-profile drying value. — if unknown. |
| `$qrurl$` | Permanent consumption link for this spool. Use this in qrData. |
| `$labelwidth$` | Template width in mm, e.g. 40. |
| `$labelheight$` | Template height in mm, e.g. 30. |
| `$appversion$` | Current running app version, as returned by `/api/version`, without a `v` prefix. Use `Filament DB v$appversion$` to add one. |

The app version is supplied by the server when templates are loaded, including
for selected-spool previews and the print editor. It uses the deployed
`APP_VERSION` or the local `VERSION` fallback. If version metadata is unavailable,
this variable resolves to `—`. Saved templates retain the variable expression;
instantiated label exports contain the version value.

Optional text values are empty when unavailable. Unknown nozzle/bed profile
values, flow ratio and drying are `—`; no missing estimates are invented.
Profile variables use the current guide/card values passed to the native
editor. Numeric weight/diameter values use a decimal point and omit units;
add `g` or `mm` as literal text where desired. Zero weight is preserved as `0`.

`$filamentcolor$` is **RGB hexadecimal**, including `#`: blue is `#0000FF`.
`$filamentcolorrgb$` is the CSS form `rgb(0, 0, 255)`, suitable for a text or
color property. For example, `"fill": "$filamentcolorrgb$"` is supported.
The thermal printer still produces monochrome output. Keep important text
black for legibility; using a pale filament color as ink may disappear during
monochrome conversion. To print the RGB value itself, place the variable in
`text`, as in the first example.

## JSON compatibility and limits

Use `version: 3`, a `name` string, `labelSize: {"width": 40, "height": 30}`
(or another supported pair), and an `elements` array. Supported element types
are `text`, `qr`, `shape`, and embedded PNG/JPEG `image` elements. The optional
boolean `isTemplate` marker is accepted and removed from instantiated labels;
the dollar syntax described here is independent of Phomymo's dataset/template
features. Multi-label sheets, PDF and barcode elements remain unsupported.

Template imports are limited to 1 MiB and 100 elements. Resolved values must
also satisfy the existing design rules: text at most 5,000 characters, QR data
at most 2,953 characters, valid colors and safe embedded images. Images cannot
fetch remote content; the exact bundled Bambu Lab wordmark is the sole trusted
SVG exception. Element IDs must be unique and fixed. QR rotations must be
multiples of 90 degrees. Inspect the preview and enlarge a QR area if density
checks reject it. No template import starts a printer connection or job.

Colors support `black`, `white`, `transparent`, `none`, `#RRGGBB` and
`rgb(r, g, b)` with integer channels from 0 through 255. Use values appropriate
to the field: `none` is intended for shape fill/stroke.

Malformed imports, incorrect sizes, unknown variables and database/network
failures do not replace the previous template. A corrupt stored template is
reported and blocks its preview/print rather than silently printing a different
layout. Remove/reimport the affected size in template settings to recover.

## Verification

Automated tests cover variable binding, literal/nonrecursive substitution,
RGB validation, all preset sizes, independent storage, invalid-file rollback,
import/export/removal UI, size switching, template revision precedence and
current spool data, selected-spool previews, shared API persistence, stale-client
conflicts and repeatable database migration. They do not validate physical output. The user verifies
layout, paper alignment, readability and QR scanning on the actual printer.
