"""One-time recovery of file provenance from surviving planned projects."""


def backfill_print_archive_links(conn):
    if conn.execute(
        "SELECT name FROM migrations WHERE name='print_archive_links'"
    ).fetchone():
        return
    conn.execute("""UPDATE prints SET archive_file_id=(
        SELECT p.archive_file_id FROM projects p
        JOIN archive_files f ON f.id=p.archive_file_id
        WHERE p.print_id=prints.id ORDER BY p.id LIMIT 1)
        WHERE archive_file_id IS NULL""")
    conn.execute("INSERT INTO migrations (name) VALUES ('print_archive_links')")
