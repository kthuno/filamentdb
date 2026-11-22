# Getting started

[Back to README](../README.md)

- [Run locally](#run-locally)
- [Install as a browser app in Brave](#install-as-a-browser-app-in-brave)

## Run locally

Requires Python 3.11 or later:

```sh
python3 -m src.app
```

Python code lives in `src/`, and tests in `tests/`. Run module commands from the project root.

Open http://127.0.0.1:49173. The database is created automatically at `data/filaments.sqlite3`. Configure `HOST`, `PORT`, and `DATABASE_PATH` as needed.

No sample spools are loaded automatically. Your inventory starts empty.

## Install as a browser app in Brave

After deployment, open the app's permanent HTTPS address in Brave, such as `https://filament.example.com`, using a certificate trusted by the browser. Click the install icon in the address bar or choose **Save and Share → Install Filament DB** from Brave's menu. Brave determines when installation is available. Manage installed apps at `brave://apps`.

The app receives its name and spool icon and opens in a standalone window. Installation also works locally at `http://127.0.0.1:49173`; use the permanent HTTPS address for regular use. An ordinary HTTP address on the local network does not meet installation requirements. Installation is tied to the address used.

The app requires a server connection. There is no service worker or offline cache for inventory, API responses, or frontend files; normal reloads fetch the current version. After deployment, use **Reload app** next to the database information at the bottom left. The button appears only in an app window; on mobile it is in a bottom bar. The manifest and local 192- and 512-pixel PNG icons are served by Python and included in the Docker image.

References: [Brave web apps](https://support.brave.app/hc/en-us/articles/39077114659597-How-do-I-install-and-use-Web-Apps-in-Brave) and [installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## See also

- [Deployment](deployment.md)
- [Inventory and locations](inventory-and-locations.md)
