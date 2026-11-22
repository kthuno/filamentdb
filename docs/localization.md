# Language files and translation

[Back to README](../README.md)

Interface text is loaded from JSON language catalogs. The bundled catalogs are Danish (`static/locales/da.json`) and English (`static/locales/en.json`, locale `en-GB`). Danish remains the default and fallback. It covers navigation, forms, placeholders, help text, dialogs, QR labels, dynamic views, and known API errors. Static HTML has fallback text and `data-i18n` markers; dynamic text uses `t()`/`th()` from `static/i18n.js`. User data and API codes are not translated: names, notes, material types, slicer metadata, and saved AI articles remain as entered.

Add a language without a build step:

1. Copy `da.json` to a new language file, for example `de.json`, in the same directory.
2. Set `language` to `de` and `locale` to, for example, `de-DE`. Translate values in `messages`; preserve keys and placeholders such as `{p0}`. Use text, not HTML.
3. Add `{"code":"de","name":"Deutsch","locale":"de-DE"}` to `languages` in `static/locales/index.json`. The default remains `da`.
4. Reload the app. The compact language selector is next to the version in the bottom-right footer on desktop and mobile. The choice is remembered locally and included as `?lang=de`; page navigation and QR/deep links are preserved when switching languages.

Missing translations fall back to the default catalog. Numbers, dates, and display-text sorting follow the selected locale; grams, DKK, and stored values do not change. A message can have plural forms: `{"countParam":"p0","one":"{p0} file","other":"{p0} files"}`. Supported categories are `zero`, `one`, `two`, `few`, `many`, and `other`; `other` is required. Simple singular/plural messages use `tn()`. Use `th()` for HTML, continuing to escape user data when inserting it.

API calls send the selected language in `Accept-Language`. Known errors are translated from the same catalog and also include `error_key`/`error_params`; unknown system errors retain their original text. JSON files are served only for registered languages through `/locales/{code}.json`. No database changes, new packages, CDN, external services, or host settings are required.

Project documentation is maintained in English regardless of the selected interface language. Translating documentation does not add an interface catalog or change the default language.

## See also

- [Architecture](architecture.md)
- [Development and testing](development.md)
