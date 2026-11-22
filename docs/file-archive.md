# File archive

[Back to README](../README.md)

- [Uploads, metadata, and estimates](#uploads-metadata-and-estimates)
- [Images from 3MF files](#images-from-3mf-files)
- [Print history per file](#print-history-per-file)

## Uploads, metadata, and estimates

The file archive stores original `.3mf` files up to 30 MB, extracted metadata, and custom notes. Upload files here, then create upcoming projects from them. Select several files at once; uploads run sequentially without opening dialogs, showing progress/errors on the page. A failed file does not stop the others. The 30 MB limit is per file. Afterwards, click cards to edit title, notes, and estimates. Identical bytes are reused through SHA-256 even with different filenames, without overwriting existing titles/notes. Different content versions become separate archive entries.

Search title, filename, and notes; view all plates/filament details; edit title/notes; set expected time/consumption per plate; download originals; or delete files. **Create project** opens the project form with file metadata so you can select one plate and edit project-specific notes/estimates. Archive and project notes are independent. Under **Expected time and consumption**, choose a plate and enter hours/minutes and grams. Custom values are separate from original metadata and become defaults for new projects, including reimports of identical bytes. Empty fields use original estimates; missing originals remain unknown. **Create upcoming project** in the archive dialog saves current edits first. Later archive edits do not affect existing projects. Project cards/forms link back to the archive, which shows linked projects. Missing estimates remain unknown.

Deleting a project preserves the original file and archive notes. Deleting an archive entry removes its original/notes and clears project links, preserving existing projects, their metadata/thumbnails, recorded prints, and consumption. Originals cannot be reconstructed from metadata. Projects imported before the archive have no original file; upload it again to create new archive-linked projects.

**Storage:** Originals live in `data/files/` beside the SQLite file, or `/data/files/` in the existing Docker `filament-data` volume, including MySQL operation. Server-generated names keep user filenames separate from filesystem paths. Contents are not extracted; each complete 3MF is stored as one file. Metadata and custom estimates (`plate_estimates`) are stored in `archive_files`, with optional `projects.archive_file_id` links. Metadata originates from the file and is unverified.

**Before deployment:** Existing Compose files require no new grants, ports, nginx settings, or mounts. The 30 MB upload limit and nginx `client_max_body_size 32m` still apply. Ensure `/data` has space and backups include `/data/files/`. A MySQL dump alone contains no originals. App deployment does not update host backup jobs. Other local setups can use `FILE_ARCHIVE_PATH` for a writable persistent directory; custom container paths require an explicit mount and access for UID/GID 10001.

API:

- `POST /api/files`: raw 3MF bytes with URL-encoded `X-Filename`; returns preview and `archive_file_id`.
- `GET /api/files`: list with title, notes, filename, size, SHA-256, and project count.
- `GET /api/files/{id}`: metadata, notes, and linked projects.
- `PUT /api/files/{id}`: `{ "name": "Title", "note": "My notes", "plate_estimates": { "1": { "estimated_seconds": 7200, "estimated_grams": 250.5 } } }`. Optional `plate_estimates` uses file plate IDs as keys; omitting it preserves existing estimates. `{}` resets all estimates to original metadata; `null` for a single field uses its source value. Time is an integer from 0 to 100,000,000 seconds; consumption is a finite number from 0 to 1,000,000 grams. Original bytes/metadata remain unchanged; upload changed contents as a new entry.
- `DELETE /api/files/{id}`: deletes the entry, unlinks projects, and removes the original after database commit.
- `GET /api/files/{id}/download`: original bytes as an attachment with the original filename.
- `GET /api/files/{id}/preview`: metadata/thumbnail for a new draft without creating a project.

Projects accept optional `archive_file_id`; the file must exist and match the metadata SHA-256. Older clients omitting it during edits preserve the existing link. Writes use the app's shared transaction lock. Failed uploads roll back new files/rows. Deletion removes files only after commit; crashes or missing delete permissions can leave unreferenced files on disk. Delete errors are logged. A hard stop during upload can also leave an unreferenced file; the app serves only files with database records.

## Images from 3MF files

Cards show a thumbnail extracted from original 3MF metadata. In file details, the image follows the selected plate. Without a thumbnail, a file icon and explanatory message are shown. Images load on demand through `GET /api/files/{id}/image` with an optional `plate` parameter, using the existing limited reader without disk extraction, external calls, or new database fields. Existing archived files are supported too.

Linked prints show images from the original file: history uses the first available thumbnail, while the print dialog shows every plate with an image. Custom image upload/paste fields are hidden while a file is selected. Missing file images do not fall back to an older print image. A previously saved custom image remains stored and can appear again after removing the file link.

## Print history per file

Cards show print-record count and latest print date. Open a file to see print names, dates, and statuses; click a print to open it. Pending and failed prints also count and show their statuses.

Prints from upcoming projects inherit their original file link. Manual prints can select **File from archive** in the print dialog, including during later edits. **Print again** copies the link. The link belongs directly to the print and survives project deletion. Deleting an original clears only file links; prints, consumption, and other project metadata remain. Deleting an incorrect print removes it from the file's count and restores inventory atomically.

SQLite and MySQL migrate automatically with optional `prints.archive_file_id` and an index. A one-time migration transfers source files from surviving project links. If a project was already deleted before upgrading, the app does not guess the original; select it manually on the print. No new grants, external services, or host settings are required.

## See also

- [Upcoming projects](projects-and-shopping.md)
- [Database and original-file backups](backup.md)
