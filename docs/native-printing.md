# Native M220 printing and label editing

[Back to README](../README.md) · [QR labels](inventory-and-locations.md#phomemo-m220-labels)

Open **QR labels**, expand **Print via USB/Bluetooth**, then choose a spool's
**Open print and design** action.
This native dialog uses the spool's permanent link and current label-profile
values. It does not change inventory, spool metadata, consumption, or print
records. Classic A4 browser printing and PNG/JSON export from the designer
remain available.

## Find a spool

The QR labels page owns all label workflows. Inventory cards no longer have a
label button, and the former single-spool label dialog has been removed.
**Print via USB/Bluetooth**, **QR labels on A4**, and **Label templates** expand
and collapse independently. The native spool overview includes current, empty
and archived rolls as individual records, with 12 cards per page.

Local search matches name, material, manufacturer, color/color code, product ID,
location/active slot and spool number. Multiple search terms combine; search
ignores case and supports Danish characters. Material/manufacturer filters
combine with search and reset the spool overview's page number. A4 selection
and inventory filters remain independent.

Manufacturer/material profiles load only for an opened native spool or a
selected template preview. Lookups are cached and limited to four concurrent
requests. Textured PEI (or the first available plate) and the first drying
condition provide initial values; unmatched/failed lookups retain saved spool
temperatures. Edit individual label content in the designer. Saved native
labels keep manual overrides while unedited variables refresh from current
spool data. See [size-specific templates](label-templates.md).

## Design and preview

Native designs use the selected size and its configured JSON template. The
last selected size is remembered; otherwise an available template is preferred
(70 × 80, then 60 × 40, then 40 × 30 mm), with 70 × 80 mm as the final fallback.
Without a custom template, native labels
share a built-in visual style: the wide Bambu Lab wordmark, a white material name on a
black band, a separate hexadecimal color code, color below the band, profile
values at the lower left, and a QR code at the lower right. The material name
keeps its stored capitalization, such as **PLA Matte**. All three preset sizes
use the same layout rules. The native workflow retains exact 8 dots/mm.

The Bambu Lab wordmark is the existing bundled vector artwork, with its
CC BY-SA 4.0 attribution preserved in the embedded image metadata and JSON.
It is included for Bambu/Bambu Lab/BambuLab spools. Other manufacturers use
text. The QR code uses a round top-left finder with the other two finders
square. Native QR rendering fills the element square with a one-module white
margin, matching Phomymo.
The inspector can choose square or round-top-left finders. The `finderStyle`
property is a native extension retained by JSON export; external Phomymo
renderers that do not understand it will use their normal square QR finders.

The earlier supplied Phomymo example files and the obsolete embedded example
layout have been removed. Import compatibility is covered by synthetic
text/image/shape/QR test designs. Existing saved designs remain unchanged;
use **Spool design** (or **Apply template** for a configured size), then
**Save design in browser** to apply that design explicitly to a saved label.

The default editor is the locally bundled Phomymo graphical designer: select,
drag, resize, rotate, align, group, reorder and duplicate elements, with
undo/redo and the upstream desktop/mobile property panes. It supports text,
QR, barcodes, shapes, PNG/JPEG images and PDF first-page image import. Image
brightness/contrast and per-image dithering are preserved. Barcodes use the
bundled JsBarcode encoder and fail explicitly if their field is too narrow.
The advanced numeric inspector and final print preview remain in a collapsed
section. Host controls still own size, copies, darkness, feed, connection,
JSON/PNG export and browser-local individual design saves.

The designer is served from `/vendor/phomymo/`, with all runtime libraries and
precompiled styles bundled locally. There is no dependency on a running
Phomymo site, CDN, Google Fonts, npm or a runtime build step. Its canvas uses
available local/system fonts. The upstream designer controls retain English
vendor strings; Filament DB controls use the selected interface catalog.

An opaque-origin iframe sandbox allows scripts and user downloads, without
same-origin access, forms, popups, printer permissions or app API access.
CSP blocks network connections and external images; an explicit server asset
allowlist enables module CORS. Only validated design documents cross a
frame/source/session-checked message bridge. Saving/exporting/printing requests
an immediate canvas snapshot, so a pending edit debounce cannot print an older
revision. Printer transfer and shared template writes execute only in the host.

Dataset CSV templates, printer management and multi-label sheets are hidden;
Filament DB's dollar-variable templates and three supported sizes remain the
source of truth. Shared templates use their opening revision when saved, even
if a background reload discovers a newer one. Template edits and per-spool
concrete edits remain separate.

**Import Phomymo JSON** accepts version 3 designs with the supported elements
and one of the three preset sizes. Import preserves original content, element
IDs, positions and embedded image data, including the original QR payload.
Check that payload before printing an imported reference. Import unresolved
variable templates through Label templates rather than this concrete-design
import action. **Apply template** rebuilds the current size using its template;
**Spool design** is the fallback action when no template is configured. Each
size has an independent working draft, so size changes select the appropriate
template/default or restore that size's edits. Enlarge a QR field if density
checks reject it.

**Save design in browser** stores the design for this spool and size in browser-local
storage. It is restored when this spool's native dialog is opened again.
Edits are not automatically saved. JSON export provides a portable copy;
designs stored only in the browser are outside database backups. Print settings
are stored locally after submitting a print. No device is connected on startup.

The preview, PNG export and printer output share the same dot grid
and final monochrome raster.
The M220 is nominally 203 DPI, using exactly 8 dots/mm:

| Label width × height | Label raster | Printer raster |
|---|---|---|
| 40 × 30 mm | 320 × 240 dots | 576 × 240 dots |
| 60 × 40 mm | 480 × 320 dots | 576 × 320 dots |
| 70 × 80 mm | 560 × 640 dots | 576 × 640 dots |

The printer raster pads on the left for the M220's right-aligned roll without
scaling the label. PNG export contains only the physical label area.

Threshold is the default for text and QR. Floyd–Steinberg, Atkinson and ordered
dithering are available for grayscale artwork. QR regions retain binary
modules and their one-module white margin. Module boundaries are snapped to
printer pixels while filling the requested square, avoiding the size reduction
caused by rounding a single shared module size down. The renderer waits for embedded
images and local fonts before enabling export or print. Imported images cannot
reference external URLs or arbitrary SVG. The exact bundled Bambu Lab wordmark
is the sole SVG image exception; modified SVG data is rejected. JSON is limited to 1 MiB and 100
elements; image uploads to 500 KB, and decoded images to 4 megapixels.

## Connect and print

Choose **Bluetooth** or **USB**, then **Connect M220**, and select your printer
in the browser permission dialog. Generic Q… and Phomemo BLE names do not prove
the model; select only your M220. The first implementation targets this printer
even when other models advertise compatible-looking services or USB IDs.

- **Copies:** integer 1–99, sent sequentially.
- **Print Density (Darkness):** integer 1–8, default 6.
- **Feed after print:** integer 0–255 dots, default 32; 8 dots represent 1 mm.

BLE retains Phomymo's M-series sequence, heat/density commands and 128-byte
raster chunks with 20 ms pauses. USB retains its separate sequence, including
line spacing, an initial 12-dot feed, 512-byte chunks with 20 ms pauses, and
the adjustable final feed. No unsupported M220 speed control is exposed.

The dialog freezes editing/settings during connection and printing. **Stop
job/connection** cancels pending work and disconnects the session. **Close**
also stops/disconnects. Cancellation cannot retract bytes already delivered.
An interrupted print may be partial. Failed writes and timeouts stop the job
without retrying data or starting further copies. Reconnect explicitly before
trying again. **Transferred** confirms only successful data transfer, not
physical printing or paper movement; no paper/battery/completion claim is made.

## Browser, OS and infrastructure requirements

Both transports require a secure context (trusted HTTPS, or localhost for local
development) and a user gesture for the permission picker. Unsupported APIs
are detected before any connection attempt. JSON/PNG export and editing remain
available. Use a permanent phone-reachable app address for real QR labels;
localhost links are not reachable from another device.

Chrome/Edge on supported desktop systems are the primary targets. Chrome on
Android supports BLE on supported hardware. Safari, Firefox and ordinary iOS
browsers do not provide this direct BLE/USB workflow; use export fallback.
Browser API presence does not guarantee device or driver access. Web Bluetooth
on Linux may require browser configuration.

USB additionally depends on browser/OS access to the M220 interface. Windows
may require an appropriate WinUSB interface driver; Linux may require suitable
device permissions. Another driver or printing application can hold an
interface on any system. Driver replacement/permission changes are outside
Filament DB and are not performed automatically. USB uses vendor `0x0483`,
product `0x5740`, preferring a printer-class bulk OUT alternate, then vendor
or CDC-data bulk OUT alternates. An incompatible descriptor is rejected.

Official references: [Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)
and [WebUSB, including platform considerations](https://developer.chrome.com/docs/capabilities/usb).

All communication runs on the client. No new port, container, server Bluetooth
adapter, USB passthrough, database grant, secret or Python package is needed.
Network access needs the existing trusted HTTPS reverse proxy; deploying the
application does not provision certificates or modify host nginx. The app
remains bound to `127.0.0.1:49173` in the standard deployment. See
[deployment requirements](deployment.md#native-m220-printing).

## Architecture and upstream provenance

| Module | Responsibility |
|---|---|
| `label-templates.js`, `label-template-store.js`, `label-template-settings.js` | Size-specific JSON templates, literal variable binding, shared database storage, revision tracking and QR-page previews |
| `label-design.js`, `label-style.js` | Validated editable designs, spool defaults, shared logo/layout/QR artwork and scaling |
| `label-renderer.js` | Text/image/shape/QR rendering, independent of printer communication |
| `label-raster.js` | Grayscale, dithering, binary preview and right-aligned 1-bit packing |
| `printer-definitions.js` | Immutable M220 definition and presets |
| `printer-protocol-m220.js` | BLE/USB command encoding and pacing |
| `printer-transport.js` | Transport contract, capability checks and errors |
| `printer-bluetooth.js`, `printer-usb.js` | Browser transport implementations |
| `print-jobs.js` | Validated immutable job snapshot, sequential copies, cancellation and write timeouts |
| `label-print-dialog.js` | Private editor state, connection lifecycle, UI and local persistence |

`labels.js` passes the current spool, permanent link and profile values into
the dialog; it exports no QR selections or drafts. New modules have explicit
imports and are served by the HTTP static allowlist. There is no runtime
dependency on the hosted Phomymo application, its editor, CDN libraries or npm.

Selected Phomymo functionality is pinned to commit
[`1f58d3f0e7f941b9143277cda828380149e56855`](https://github.com/transcriptionstream/phomymo/tree/1f58d3f0e7f941b9143277cda828380149e56855).
[The bundled notice](../static/vendor/phomymo-NOTICE.txt) records source files,
adaptations, attribution, the MIT license confirmed by the project owner, and
the discrepancy between upstream README/package metadata and the missing root
license file. Original source headers are retained in the selected portions;
no unavailable upstream copyright year is invented. Filament DB's repository
license and the bundled QR library's license are unchanged.

The transport contract is `kind`, `connected`, `name`, `connect()`,
`disconnect()` and `send(bytes)`. A future authenticated Linux/macOS print
service can consume the same design/raster contract through another adapter.
It is not implemented. Such a service would require separate OS device access,
trusted HTTPS, authentication, restricted network access, job IDs/deduplication
and explicit deployment configuration; those changes are not implied by the
browser integration.

## Verification boundaries

Automated tests cover supported JSON round-trips with and without an image,
the shared Bambu Lab wordmark, material band, QR modules and finder geometry, supported rendering
commands and image readiness, spool identities, exact preset dimensions,
monochrome packing, QR protection, command bytes/pacing/copies/feed/density,
write errors/timeouts, unsupported browser behavior, USB interfaces and
alternates, cancellation during selection, and native editor/import/export/
persistence controls. Rendering tests use simulated canvas operations; they
do not establish pixel-identical font rendering or physical print quality.

The supplied advanced 70 × 80 reference has user-reported physical success
through Phomymo. This does not validate the new Filament DB renderer, USB
transport or BLE transport on hardware. The user performs visual and physical
verification: both transports, all three sizes, alignment, embedded images,
text, QR scanning, darkness, final feed, multiple copies, and interrupted jobs.
Agents do not perform browser visual checks or send unsolicited physical jobs.
