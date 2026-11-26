"""Explicit allowlist and sandbox response policy for the bundled designer."""

from .config import ROOT

DESIGNER_ASSETS = frozenset(
    [
        "vendor/phomymo/app.js",
        "vendor/phomymo/ble.js",
        "vendor/phomymo/bridge.js",
        "vendor/phomymo/canvas.js",
        "vendor/phomymo/constants.js",
        "vendor/phomymo/designer.css",
        "vendor/phomymo/elements.js",
        "vendor/phomymo/handles.js",
        "vendor/phomymo/index.html",
        "vendor/phomymo/integration.css",
        "vendor/phomymo/isolation.js",
        "vendor/phomymo/lib/jsbarcode.js",
        "vendor/phomymo/lib/jspdf.js",
        "vendor/phomymo/lib/pdf.mjs",
        "vendor/phomymo/lib/pdf.worker.mjs",
        "vendor/phomymo/lib/qrcode.js",
        "vendor/phomymo/printer.js",
        "vendor/phomymo/printers.json",
        "vendor/phomymo/storage.js",
        "vendor/phomymo/templates.js",
        "vendor/phomymo/usb.js",
        "vendor/phomymo/utils/bindings.js",
        "vendor/phomymo/utils/errors.js",
        "vendor/phomymo/utils/validation.js",
    ]
)


def designer_asset(path):
    relative = path.removeprefix("/")
    if relative not in DESIGNER_ASSETS:
        return None
    extension = relative.rsplit(".", 1)[-1]
    mime = {
        "html": "text/html",
        "js": "text/javascript",
        "mjs": "text/javascript",
        "css": "text/css",
        "json": "application/json",
    }[extension]
    headers = {"Access-Control-Allow-Origin": "*"}
    if extension == "html":
        headers["Content-Security-Policy"] = (
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
        )
        headers["Permissions-Policy"] = (
            "usb=(), bluetooth=(), local-fonts=(), camera=(), microphone=()"
        )
    return (ROOT / "static" / relative).read_bytes(), mime + "; charset=utf-8", headers
