# Direct M220 Bluetooth printing

[Back to README](../README.md) · [Label layouts](inventory-and-locations.md#phomemo-m220-labels)

## Enable and print

This is an experimental, optional addition to the existing browser Print and PNG/SVG Download actions. It is off by default and does not change inventory, label identities, print records, or database schemas.

1. Open Filament DB at its permanent **HTTPS** address in a browser supporting Web Bluetooth, such as Chrome on a supported computer or Android device. The printer must be within Bluetooth range of that device. Safari, Firefox, and iOS browsers are not supported. The existing label download/browser printing workflow remains available there.
2. Open **Administration** at the bottom of the sidebar and select **Printer available (Bluetooth printing)** under **Direct M220 printing · experimental**. This checkbox makes Bluetooth print actions available; it does not assert that a printer is connected. The separate connection status shows the actual Bluetooth session. Availability and printer settings are saved only in this browser; no device access happens automatically on startup.
3. Turn on the M220, disconnect it from Print Master or any other printer application, and choose **Connect M220**. Select your M220 in the browser's device picker. Some newer units advertise as `Q…` or `Phomemo…`, so those names are included as well; the Connect M220 action explicitly selects the M220 protocol, rather than inferring a different model from that generic name. Cancelling does not retry or print anything.
4. Generate the label image overview, select the size matching the loaded paper, and edit the four information fields as needed. Choose **Print via Bluetooth** on that label. The same separate action is available in the individual spool label dialog for Extended and Compact layouts.
5. Keep the page open during transmission. Inspect the physical label and scan its QR code before printing more. **Label sent** means that transmission finished, not that the printer confirmed physical output.

Only one label/job can be sent at a time. There is no automatic batch printing or automatic retry. Turning off the extension or choosing **Disconnect** terminates the connection and stops further writes. Bytes already received by the printer may still print. A connection failure during a job can leave a partial or complete label; check the printer before reconnecting and sending again.

The extension sends the current rendered preview, including the permanent QR link and label-only edits. It does not rotate, crop, resize, or replace the preview with guide defaults. Classic labels and A4 sheets continue to use the existing Print action.

## Settings and browser requirements

- **Print density:** 1–8, initially 6, matching Phomymo's default. Lower it if the print is too dark.
- **Paper feed after printing:** 0–255 dots, initially 32 (about 4 mm). This is additional feed after all image rows; it is not the label height. Adjust for your roll if alignment or feeding needs correction.
- **Bluetooth transfer:** 128-byte packets with a 20 ms pause, as used by Phomymo. The 20-byte slow setting is available for Bluetooth stacks that reject larger writes. A failed write is never replayed automatically with a different packet size or response mode.

Web Bluetooth requires a secure context and explicit device permission from a user gesture. Network HTTP addresses do not qualify; localhost/127.0.0.1 are exceptions for local development. A label generated on localhost also contains a localhost QR link, so use the permanent phone-reachable HTTPS address for real labels. If site policy blocks Bluetooth, the browser reports a permission error.

No Bluetooth adapter, USB access, additional container, Python dependency, new port, or database grant is required on the app server. The existing host HTTPS proxy is sufficient. If the app is currently accessed through HTTP on the LAN, the user must provide/use its trusted HTTPS address; deploying the app does not configure host certificates. See [deployment requirements](deployment.md#direct-m220-bluetooth-printing).

## Repository analysis and protocol

Reviewed upstream: [transcriptionstream/phomymo](https://github.com/transcriptionstream/phomymo), commit [`1f58d3f0e7f941b9143277cda828380149e56855`](https://github.com/transcriptionstream/phomymo/tree/1f58d3f0e7f941b9143277cda828380149e56855), retrieved November 22, 2026.

Relevant upstream sources:

- [`printers.json`](https://github.com/transcriptionstream/phomymo/blob/1f58d3f0e7f941b9143277cda828380149e56855/src/web/printers.json): M220, 203 dpi, 72 bytes/576 dots per row, right-aligned roll, M-series protocol.
- [`constants.js`](https://github.com/transcriptionstream/phomymo/blob/1f58d3f0e7f941b9143277cda828380149e56855/src/web/constants.js) and [`ble.js`](https://github.com/transcriptionstream/phomymo/blob/1f58d3f0e7f941b9143277cda828380149e56855/src/web/ble.js): GATT service `0xff00`, write characteristic `0xff02`, write-property detection, and 128-byte packets with 20 ms pauses.
- [`printer.js`](https://github.com/transcriptionstream/phomymo/blob/1f58d3f0e7f941b9143277cda828380149e56855/src/web/printer.js): M-series BLE initialization, heat/density commands, raster framing, and final feed.

Filament DB has its own limited implementation of these protocol details rather than bundling the upstream designer or transport. At the reviewed commit, README declares MIT and references a LICENSE file that is absent from the tree, while package.json declares ISC. No upstream source code, libraries, or license text is copied into this extension. The upstream project is credited as the protocol reference. Phomymo itself credits vivier/phomemo-tools and other reverse-engineering work.

Upstream [M220 issue #14](https://github.com/transcriptionstream/phomymo/issues/14) documents right-aligned rolls and newer units with generic advertisement names. [Issue #52](https://github.com/transcriptionstream/phomymo/issues/52) also reports small-label alignment problems. This implementation preserves every source column and pads on the left, with explicit tests for 40 × 30 mm labels. These reports reinforce the need for a physical trial on the actual printer.

The send sequence is:

| Stage | Bytes / behavior |
|---|---|
| Initialize | `1B 40`, then 100 ms |
| Heat settings | `1B 37 07 heat 02`, then 30 ms; density 1–8 maps to heat 40, 60, 80, 100, 120, 140, 160, 200 |
| Density | `1D 7C density`, then 50 ms |
| Raster header | `1D 76 30 00 48 00 heightLow heightHigh`; `48` is hexadecimal 72 bytes |
| Raster | Row-major, black = 1, MSB first, 576 dots per row; sequential packets with 20 ms pauses |
| Finish | Wait 300 ms, send `1B 4A feedDots`, wait 800 ms |

The existing 203 dpi SVG is rendered at exactly its native dot dimensions. Pixels are thresholded at 160 after alpha compositing over white. White padding on the left extends each row to 576 dots, preserving the M220's right alignment. For the supported label sizes, this retains all 320, 480, or 559 image columns without scaling the QR modules. The standard label margins and QR quiet zones remain part of the image.

The adapter is deliberately M220-only: it requests M220, Q, and Phomemo name prefixes, service `0xff00`, and characteristic `0xff02`. Generic advertisement names cannot prove the model; the user must select their M220. It chooses writes with or without response from the characteristic properties. It does not probe unrelated devices, change printer firmware, query battery/paper status, support USB or other printer models, or claim physical completion. A write timeout or GATT error disconnects the session without retransmitting a packet.

Browser requirements are documented by [Chrome's Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth) and the [Web Bluetooth specification](https://webbluetoothcg.github.io/web-bluetooth/).

## Isolation and removal

`static/m220-bluetooth.js` contains raster packing and the Bluetooth session. `static/m220-printing.js` owns only the optional UI, browser preference, and its own delegated click handler. `labels.js` passes callbacks for the current label; QR selections and drafts are not exported. Importing the extension does not connect to a device. No write API or database operation is added.

To stop using it, turn off **Printer available (Bluetooth printing)**. The connection is closed and its print buttons disappear; existing Print and Download remain available.

To remove the implementation entirely:

1. Remove the `initM220Printing` import and its single registration call from `static/labels.js`.
2. Remove `data-m220-print` buttons and M220 status elements from `static/labels.js` and `static/index.html`, plus the `m220-panel` section on the Administration page in HTML.
3. Remove `static/m220-bluetooth.js`, `static/m220-printing.js`, their entries in `src/http_reads.py`, the extension's CSS block, and `m220.*` translation keys.
4. Remove `tests/m220-bluetooth.test.cjs` and its two module-presence assertions in `tests/test_app.py`; update the related documentation and rebuild graphify.

No database migration, data cleanup, or deployment infrastructure rollback is needed.

## Verification

Automated tests use simulated GATT devices and fixed raster vectors. They cover alignment, bit order, all supported widths, transparency, image dimensions, protocol commands, byte counts, packet boundaries, response-only characteristics, cancellation, concurrent jobs, disconnects, and no-retry behavior. UI tests verify opt-in, browser requirements, edited-preview selection, disabling, and preservation of the existing print/download handlers. HTTP tests verify that both new modules are served through the allowlist.

Physical Bluetooth pairing, print alignment, feed behavior, and QR scanning require manual testing with the user's M220 and browser. They cannot be established by the simulated transport tests.
