# Lessons learned

[Back to README](../README.md)

- [Articles and categories](#articles-and-categories)
- [Print sources and editing](#print-sources-and-editing)
- [Search and filters](#search-and-filters)
- [Storage and API](#storage-and-api)

## Articles and categories

The lessons-learned area collects print experience as articles. Cards/details highlight draft status in orange, published in green, and archived in muted text. Create an article manually, choose a category/evidence class, and save it as **Draft**, **Published**, or **Archived**. Observation, possible cause, resolution, and lessons have separate fields. **Verified finding** requires explicit confirmation of testing or repeated experience.

**Manage categories** is collapsed initially. Open it to see all categories and total article counts, including drafts/archived articles. Click a category to filter while preserving other filters. Create categories in the same panel. **Rename** loads a name into the form; choose **Save name** or **Cancel**. Renaming preserves article links. **Delete** requires confirmation and works only for categories without any articles, including drafts/archived articles. First move their articles by editing them. Deleted default categories are not recreated on restart. Enter tags separated by commas.

## Print sources and editing

Articles can have several print sources with explanations and relationship types. Source materials come from the prints' actual spools. The source button opens the existing print editor. A print used as a source cannot be deleted until all article source links are removed. Unlinking preserves articles. Editing lessons learned never changes filament weights or consumption.

After editing, the saved article appears with updated content even if it no longer matches overview filters. Returning to the overview preserves filters. **Delete article** permanently removes an article after confirmation, deleting only article text and tag/source links. Prints, spools, consumption, categories, and tags remain. Use archived status to retain an article for later.

## Search and filters

Search covers title, summary, observation, possible cause, resolution, lessons, and tags. Tags appear as green badges on cards/details. Click a card tag to filter while preserving other filters. The tag filter uses browser autocomplete with all tags currently attached to articles, including drafts/archived articles. Choose a suggestion or enter the full tag; text search also matches parts of tags.

Combine category, evidence, status, tag, and material filters. Material filters match complete types such as `PETG Basic`; text search matches phrases. MySQL combines FULLTEXT with literal text search so short terms like PLA and PEI are found. SQLite uses text search without extra dependencies.

## Storage and API

Schema upgrades run at startup on SQLite (development) and MySQL (production). Existing configuration/backup methods remain. Articles are included in database backups, not spool CSV exports. Phase 1 requires no new environment variables. See [AI suggestions](ai-suggestions.md) for suggestions from saved print notes.

API: `GET/POST /api/knowledge`, `GET/PUT/DELETE /api/knowledge/{id}`, `POST /api/knowledge/{id}/publish`, `POST /api/knowledge/{id}/archive`, `GET/POST /api/knowledge-categories`, `PUT/DELETE /api/knowledge-categories/{id}`, and `GET /api/knowledge-tags`. The last endpoint returns tags in use with total article counts. Article payloads include `title`, `summary`, `observation`, `possible_cause`, `resolution`, `lessons_learned`, `category_id`, `confidence`, `status`, `tags`, and `sources`. Sources have `print_id`, `note`, and `relationship_type` (`source`, `test`, `confirmation`). New verification requires `confirm_verified: true`. Origin/timestamps are server-managed. Overview query parameters are `q`, `category_id`, `confidence`, `status`, `tag`, and `material`.

## See also

- [AI suggestions from print notes](ai-suggestions.md)
- [MySQL and required grants](mysql.md)
