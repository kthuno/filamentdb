# AI suggestions from print notes

[Back to README](../README.md)

- [OpenAI configuration](#openai-configuration)
- [Generate and review a suggestion](#generate-and-review-a-suggestion)
- [Limits, error handling, and data](#limits-error-handling-and-data)
- [Troubleshooting organization verification](#troubleshooting-organization-verification)

## OpenAI configuration

OpenAI settings come from `OPENAI_API_KEY` and `OPENAI_MODEL` in the environment. Create a local `.env` only if it does not already exist; `.env.example` shows both variables without secrets. Otherwise add them to the existing file. Use `OPENAI_MODEL=gpt-5-mini` and enter your own key locally. Protect the file with `chmod 600 .env`. `.env` and `.env.mysql` are Git-ignored and excluded from the Docker build context. The app does not create or overwrite existing environment files.

With ordinary `docker compose -f compose.yaml`, Compose loads `.env` automatically. The deployment script loads an existing `.env` first, then the selected environment file (default `.env.mysql`). The latter wins for overlapping values; exported shell variables retain Compose's normal precedence. MySQL configuration and deployment choices are preserved. For manual production commands using both files:

```sh
docker compose --env-file .env --env-file .env.mysql config --quiet
docker compose --env-file .env --env-file .env.mysql up -d --build --wait --remove-orphans
```

Continue using `python3 -m src.deploy` for updates with version increments. The commands above require both files; without an OpenAI environment file, use the existing command with only `.env.mysql`. Use `config --quiet`, as ordinary `config` prints expanded environment values, including credentials.

Direct Python startup reads only the process environment. A trusted local `.env` with shell-compatible assignments can be loaded into the current terminal before starting:

```sh
set -a
. ./.env
set +a
python3 -m src.app
```

Compose forwards only the two OpenAI variables to the backend container as runtime environment values. They are not build arguments, stored in the image, or exposed through the frontend/API. Docker administrators can read the container environment, as with existing MySQL credentials.

`src.config.openai_settings()` validates key and model on first use and reports errors without exposing credentials. Python has no hardcoded model default, and the key value is excluded from the configuration object's text representation. Normal startup, inventory, and manual articles require no OpenAI key. API calls happen only when you choose **Generate knowledge suggestion**; saving a print never analyzes notes automatically.

The agreed setup uses the Filament DB project and `filamentdb-backend` service account, model `gpt-5-mini`, and a USD 5 monthly budget. The budget is managed in the OpenAI project; the app does not enforce a local monthly spending cap. Earlier model-access diagnostics and their resolution are described below.

## Generate and review a suggestion

From **Lessons learned → From print note to knowledge**, select a print and choose **Generate knowledge suggestion**. The same action is available when editing a saved completed or failed print. Save changed notes, name, and status, then reopen the print before analysis. Empty notes and pending/in-progress prints are rejected. Only the selected print's saved title, note, status, date, actually used material types, and article categories are sent to OpenAI. Images, project links, spool identities, prices, and other print history are not sent.

The suggestion opens in the article dialog with an AI marker, the original note, and the print source attached. All text fields, category, tags, and evidence class are editable. Status always starts as **Draft**. AI may suggest only **Observation** or **Hypothesis**. **Verified finding** still requires separate user confirmation. Select **I have reviewed and approve the content**, then **Approve and save article** after review. Publishing requires selecting **Published** yourself or publishing later. AI-assisted articles use `origin: "ai_assisted"`, preserved during editing.

**Discard suggestion**, closing the dialog, or reloading saves no article. Suggestions are temporary and have no dedicated database table. If the note lacks concrete experience, an explanation appears without opening an article. Manual creation, search, and existing inventory functions still work without an API key or when the API fails.

## Limits, error handling, and data

The backend uses the standard-library HTTPS client against `https://api.openai.com/v1/responses`, the configured model, and a strict JSON schema through Structured Outputs. Output is also validated locally; extra fields such as publication status or verified evidence are rejected. Notes are treated as untrusted source data in the prompt, not instructions. The model receives no tools or external lookups. See [OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

- At most 24,000 UTF-8 bytes of source context including categories, 4,000 output tokens including reasoning, and 128,000 bytes of HTTP response.
- A 45-second network timeout, low reasoning effort, and no automatic retries. HTTPS redirects are not followed with the API key.
- One concurrent AI call per backend process. The inventory database connection is closed before the network call so normal inventory recording does not wait for AI.
- Up to 32 validated results are reused in memory for 30 minutes if source context, categories, model, and key are unchanged. Restart clears the cache. Clicking again after expiry or note changes can incur another API call. The cache is local to each container.
- Logs contain only token counts, cache hits, and general error/HTTP codes. Notes, AI text, headers, and credentials are not logged.
- Requests use `store: false`. This does not guarantee no provider retention: OpenAI separately describes abuse monitoring with possible content retention for up to 30 days by default and exceptions. API data is not used for training by default without opting in. Review the project's data controls before production use; see [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

API: `POST /api/prints/{id}/knowledge-suggestion` returns `suggestion`, `source`, and `cached` without database changes. A missing source gives 404; empty notes or unfinished prints give 400; an active call gives 409; network/configuration errors and access/usage limits give 503; invalid AI output gives 502. A suggestion with `sufficient: false` gives 200 with an explanation in `reason`. Saving uses the existing article API and requires `origin: "ai_assisted"` and `approve_ai: true`. The API key is never exposed to the browser.

Automated tests use only mocked OpenAI responses. A production-container diagnostic returned HTTP 200 for the `gpt-5-mini` model lookup but HTTP 404 / `model_not_found` for a minimal Responses call with synthetic text because organization verification was required. The user confirmed OpenAI was working on 2026-11-15, resolving that earlier blocker. No print notes or inventory data were sent during diagnostics.

## Troubleshooting organization verification

OpenAI may require API organization verification even if the key is valid and the model is visible through the API. In the 2026-11-14 production diagnostic, Responses API rejected `gpt-5-mini` with HTTP 404 / `model_not_found`, explicitly requiring verification. This is a provider requirement, not a database grant or Docker setting.

Open [OpenAI Organization → General](https://platform.openai.com/settings/organization/general) for the organization behind the **Filament DB** API project and choose **Verify Organization**. Follow OpenAI's process. The API error stated changes could take up to 15 minutes to propagate; then retry **Generate knowledge suggestion**. See [OpenAI organization verification guidance](https://help.openai.com/en/articles/10910291-api-organization-verification). The app does not perform verification or change the model/credentials automatically.

The app's error handling explains organization verification directly. Other errors distinguish model access, output schema, API quota, and temporary server failures. Backend logs show HTTP status and allowlisted error codes/parameter names; raw error messages, API keys, and notes are not exposed.

## See also

- [Lessons learned](lessons-learned.md)
- [Deployment](deployment.md)
