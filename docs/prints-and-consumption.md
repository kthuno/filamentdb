# Prints and consumption

[Back to README](../README.md)

- [Individual consumption and corrections](#individual-consumption-and-corrections)
- [Record prints with multiple spools](#record-prints-with-multiple-spools)
- [Print time](#print-time)
- [Waste and failed prints](#waste-and-failed-prints)
- [Search consumption history](#search-consumption-history)
- [Consumption statistics](#consumption-statistics)

## Individual consumption and corrections

- Consumption shows all consumption records and their total weight. Deleting an incorrect record returns grams to its original spool. If manual weight changes would make restoration exceed the original weight, deletion is rejected until the weight is corrected.
- Record grams against a specific spool with an optional project note. Remaining weight is deducted automatically and dated history is saved. Consumption cannot exceed remaining weight. On grouped cards, the action is under individual spools. History is deleted with the spool and included in database backups, not CSV exports. Manual changes to remaining weight do not create consumption records.

## Record prints with multiple spools

Under **Consumption → Record print**, enter a project name, date, optional note, and optional project link to the model/source. Links must use HTTP/HTTPS and open through **Open project** in a new tab. They can be edited or removed and are included in database backups. Search for inventory rolls, add them, and enter grams for each. Active spools appear first; empty/already selected rolls are excluded. The form shows total grams. Upload an image or paste from the clipboard using Ctrl+V / ⌘V in the dialog. Images up to 20 MB are downscaled locally to JPEG at most 960 pixels wide/high and appear as clickable history thumbnails. Images are stored in the database and backed up with it.

The entire print is saved in one transaction. If a roll lacks filament or no longer exists, nothing is saved. History shows the print as one entry expandable into its spools. Click its card to reopen the image and lines. Name, date, note, image, and consumption can be edited; remaining weights update together and invalid consumption rejects the whole change. **Delete print** restores every spool's remaining weight atomically. If a manual weight adjustment prevents restoration, the entire record is retained until corrected.

Choose **Pending**, **In progress**, **Completed**, or **Failed** status and record results in **Note / lessons learned**. Status appears on cards and remains editable. All four statuses count toward consumption/statistics; changing status does not restore filament. Pending/in-progress prints deduct entered consumption when saved; adjust consumption/time to actual values when finished. Existing prints migrate to completed status. Copies through **Print again** start as completed.

Open a print and choose **Print again** to copy it into a new record dated today. Name, note, project link, image, and grams are copied. Check spools: each line has a selector to change rolls without losing grams. Replace empty/insufficient rolls or correct consumption. The copy uses current remaining weights and never restores weight from the original. Recording and deductions happen only on **Save print**; cancellation changes nothing. The original remains intact.

Spools used in a print cannot be deleted until the entire print record is deleted. Individual project lines cannot be removed separately. Spool-card consumption buttons and QR shortcuts still support quick individual recording. Projects and their dates/notes remain in database backups; CSV exports only filament inventory.

## Print time

The print dialog has optional hours/minutes fields. Record total time for the entire print, including prints with multiple spools. Both empty means unspecified; entered time must be at least one minute. Time appears on cards, can be edited, and is copied by **Print again**. Migration never invents time for existing prints.

Dashboard statistics show total recorded time, time spent on failed prints, averages for known times, and time per month. The count of prints with time is shown so missing data is clear. Time counts once per print regardless of spool count, follows print date and the statistics year filter, and is independent of history filters. Waste and individual consumption have no print time. Time changes do not affect remaining weight.

API field `duration_minutes` is an optional integer from 1 to 1,000,000 or `null` for unknown. It is stored in the database and included in backups.

## Waste and failed prints

Choose **Consumption → Record waste**. Enter date, reason (**Failed print**, **Purge / color change**, **Calibration**, or **Other waste**), optional note, and grams per spool. Optionally link an existing print. This is always **additional consumption**; a failed print already counts as waste through its own lines and must not be recorded twice.

Waste appears as a combined history entry with **Edit waste** and **Delete waste**. Creation, editing, and deletion update all spools atomically. An invalid line rejects the whole change. Spools with waste history cannot be deleted; individual waste lines cannot be deleted separately. Deleting a linked print removes only that link, preserving independent waste and restoring only the print's own consumption.

Statistics show total consumption, waste grams/percentage, and waste by reason. Each consumption line counts once: independent waste, failed print, or other consumption. Changing a print from failed to completed removes its consumption from waste totals without changing weights. Existing individual consumption remains ordinary consumption. Waste is included in database backups, not inventory CSV.

API: `POST /api/waste`, `GET/PUT/DELETE /api/waste/{id}`. Payload contains `waste_date`, `reason` (`failed_print`, `purge`, `calibration`, `other`), optional `note`, optional `project_id`, and `items` with `filament_id` and `grams`. `GET /api/prints` supplies print choices without images. SQLite and MySQL migrations are automatic and repeatable without changing existing remaining weights.

## Search consumption history

Under **Consumption → Consumption history**, search project names, notes, and filament details, or filter by date range, material type, and specific spool. Filters combine; material type and spool must match the same consumption line. Prints use print date; individual consumption uses its UTC recording date. Both date limits are inclusive.

A matching print always shows all its spools and full consumption. Totals above and below filters show consumption for visible records. **Reset filters** restores all history. History filters do not affect statistics, which have a separate year selector. Sort by **Date**, **Name**, or **Consumption (g)**, ascending or descending; default is date descending. Sorting applies to entire records, including multi-spool prints/waste, without changing totals. Resetting restores date descending.

## Consumption statistics

Each spool's consumption dialog shows a bar chart for the current month and previous five months, including zero-consumption months. It includes that spool's prints, individual consumption, and additional waste once per line. Prints use print date, waste uses waste date, and individual consumption uses recording date.

Dashboard also shows monthly consumption, material-type distribution, and the five most-used filaments. Select all years or one year; this applies only to statistics while history retains its own filters. Amounts are in grams; material distribution also shows percentages.

Prints follow their entered date; individual consumption follows its UTC recording date. Every line counts once, including multi-spool prints. Identical filaments are combined across rolls by manufacturer, name, material type, and color name. Editing/deleting updates statistics. Statistics rely on retained history; individual consumption deleted with a spool no longer contributes.

## See also

- [File archive and images](file-archive.md)
- [Projects and shopping](projects-and-shopping.md)
- [Lessons learned](lessons-learned.md)
