# Backup and restore

[Back to README](../README.md)

Back up the database the app currently uses. The old SQLite volume is not a backup of new MySQL records. CSV is not a complete database backup either. Shared label templates are included in database backups; browser-local individual label designs, printer settings and legacy template copies are not. See [label templates](label-templates.md) for migration and export.

The file archive requires a combined backup of the database and original files. Stop the app during the combined backup so uploads and deletions cannot change links:

```sh
docker compose -f compose.yaml stop app
docker compose -f compose.yaml cp app:/data/files ./filament-files-backup
```

Then back up the database while the app remains stopped. For MySQL, use the dump command below. For SQLite, copy all of `/data/` from the stopped container, including any WAL files, with `docker compose -f compose.yaml cp app:/data/. ./filament-data-backup`. Use new destination directories for each backup. Restart with `docker compose -f compose.yaml start app`. Before the first upload, the file directory may not exist and there are no originals to copy.

When restoring, the database and `files/` must come from the same backup. Keep the app stopped, restore the directory to `/data/files/` with UID/GID 10001, and restore the database as described below. Preserve server-generated filenames. MySQL operation requires both the MySQL dump and the file directory in the Docker volume. The same applies locally to the database and `data/files/` or your chosen `FILE_ARCHIVE_PATH`.

For MySQL, run the following on the MySQL host using a separate backup account and an interactive password prompt:

```sh
umask 077
mysqldump -h 127.0.0.1 -u BACKUP_USER -p --single-transaction --no-tablespaces --set-gtid-purged=OFF filamentdb > filamentdb-backup.sql
```

Use a new filename for every backup. Retrieve it with `scp` and keep a copy off-host. The backup account needs the necessary read privileges; the app account does not need global backup privileges. Test restoration in a separate database. For production restoration, stop the app, import the verified backup using an account with the necessary schema privileges, then restart the app.

The following applies only to SQLite development.

For a separate database-only SQLite backup, the backup API can be used while the app is running. It does not include archive originals; use the combined stopped backup above to preserve both the database and files. For Docker:

```sh
docker compose -f compose.yaml exec -T app python -c "import sqlite3; source=sqlite3.connect('/data/filaments.sqlite3'); target=sqlite3.connect('/tmp/backup.sqlite3'); source.backup(target); target.close(); source.close()"
docker compose -f compose.yaml cp app:/tmp/backup.sqlite3 ./backup.sqlite3
```

Store the backup elsewhere. To restore, stop the app (`docker compose -f compose.yaml stop app`), copy the backup to `/data/filaments.sqlite3` in the volume with correct ownership (UID/GID 10001), and remove any old `-wal`/`-shm` sidecar files while the app is stopped. Then restart. Locally, replace the database file with a backup while the app is stopped.

## See also

- [File archive](file-archive.md)
- [MySQL in production](mysql.md)
