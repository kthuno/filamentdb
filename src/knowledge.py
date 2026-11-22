"""Knowledge articles and source relationships; caller owns the transaction."""

import os
from datetime import UTC, datetime

TEXT_FIELDS = (
    "title",
    "summary",
    "observation",
    "possible_cause",
    "resolution",
    "lessons_learned",
)
CATEGORIES = (
    "Materialer",
    "Vedhæftning og printafmontering",
    "Printkvalitet",
    "Supports",
    "Køling og temperatur",
    "Printerkonfiguration",
    "AMS og filamenthåndtering",
    "Pasform og tolerancer",
    "Vedligeholdelse",
    "Generelle tips",
)


def initialize(conn, mysql=False):
    identity = (
        "BIGINT PRIMARY KEY AUTO_INCREMENT"
        if mysql
        else "INTEGER PRIMARY KEY AUTOINCREMENT"
    )
    suffix = (
        " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin"
        if mysql
        else ""
    )
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS knowledge_categories (id {identity}, name VARCHAR(100) NOT NULL UNIQUE){suffix}"
    )
    conn.execute(f"""CREATE TABLE IF NOT EXISTS knowledge_articles (
        id {identity}, title VARCHAR(200) NOT NULL, summary TEXT NOT NULL,
        observation TEXT NOT NULL, possible_cause TEXT NOT NULL, resolution TEXT NOT NULL,
        lessons_learned TEXT NOT NULL, category_id BIGINT NOT NULL,
        confidence VARCHAR(16) NOT NULL CHECK (confidence IN ('observation','hypothesis','verified')),
        status VARCHAR(16) NOT NULL CHECK (status IN ('draft','published','archived')),
        origin VARCHAR(16) NOT NULL CHECK (origin IN ('manual','ai_assisted')),
        created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL, published_at VARCHAR(32),
        FOREIGN KEY(category_id) REFERENCES knowledge_categories(id)
        ){suffix}""")
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS knowledge_tags (id {identity}, name VARCHAR(100) NOT NULL UNIQUE){suffix}"
    )
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS knowledge_article_tags (article_id BIGINT NOT NULL, tag_id BIGINT NOT NULL, PRIMARY KEY(article_id,tag_id), FOREIGN KEY(article_id) REFERENCES knowledge_articles(id), FOREIGN KEY(tag_id) REFERENCES knowledge_tags(id)){suffix}"
    )
    conn.execute(f"""CREATE TABLE IF NOT EXISTS knowledge_sources (
        article_id BIGINT NOT NULL, print_id BIGINT NOT NULL, note TEXT NOT NULL,
        relationship_type VARCHAR(32) NOT NULL, PRIMARY KEY(article_id,print_id), FOREIGN KEY(article_id) REFERENCES knowledge_articles(id), FOREIGN KEY(print_id) REFERENCES prints(id)){suffix}""")
    if mysql:
        if not conn.execute(
            "SHOW INDEX FROM knowledge_articles WHERE Key_name='knowledge_search'"
        ).fetchone():
            conn.execute(
                "ALTER TABLE knowledge_articles ADD FULLTEXT INDEX knowledge_search (title,summary,observation,possible_cause,resolution,lessons_learned)"
            )
    else:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS knowledge_source_print ON knowledge_sources(print_id)"
        )
    if not conn.execute(
        "SELECT name FROM migrations WHERE name='knowledge_categories_v1'"
    ).fetchone():
        for name in CATEGORIES:
            if not conn.execute(
                "SELECT id FROM knowledge_categories WHERE name=?", (name,)
            ).fetchone():
                conn.execute(
                    "INSERT INTO knowledge_categories (name) VALUES (?)", (name,)
                )
        conn.execute("INSERT INTO migrations (name) VALUES ('knowledge_categories_v1')")


def delete_article(conn, identity):
    """Remove an article's links without touching source prints or shared metadata."""
    if not conn.execute(
        "SELECT id FROM knowledge_articles WHERE id=?", (identity,)
    ).fetchone():
        raise ValueError("Artiklen findes ikke længere.")
    conn.execute("DELETE FROM knowledge_article_tags WHERE article_id=?", (identity,))
    conn.execute("DELETE FROM knowledge_sources WHERE article_id=?", (identity,))
    conn.execute("DELETE FROM knowledge_articles WHERE id=?", (identity,))


def save_category(conn, payload, identity=None):
    name = payload.get("name") if isinstance(payload, dict) else None
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValueError("Angiv et kategorinavn på højst 100 tegn.")
    if conn.execute(
        "SELECT id FROM knowledge_categories WHERE LOWER(name)=LOWER(?) AND id<>?",
        (name.strip(), identity or 0),
    ).fetchone():
        raise ValueError("Kategorien findes allerede.")
    if identity is None:
        conn.execute(
            "INSERT INTO knowledge_categories (name) VALUES (?)", (name.strip(),)
        )
    elif (
        conn.execute(
            "UPDATE knowledge_categories SET name=? WHERE id=?",
            (name.strip(), identity),
        ).rowcount
        != 1
    ):
        raise ValueError("Kategorien findes ikke længere.")


def delete_category(conn, identity):
    """Keep every article, including archived articles, attached to its category."""
    if conn.execute(
        "SELECT id FROM knowledge_articles WHERE category_id=?", (identity,)
    ).fetchone():
        raise ValueError(
            "Kategorien bruges af artikler. Flyt artiklerne til en anden kategori, før du sletter den."
        )
    if (
        conn.execute(
            "DELETE FROM knowledge_categories WHERE id=?", (identity,)
        ).rowcount
        != 1
    ):
        raise ValueError("Kategorien findes ikke længere.")


def get_article(conn, identity):
    row = conn.execute(
        "SELECT a.*,c.name AS category FROM knowledge_articles a JOIN knowledge_categories c ON c.id=a.category_id WHERE a.id=?",
        (identity,),
    ).fetchone()
    if not row:
        return None
    article = dict(row)
    article["tags"] = [
        r["name"]
        for r in conn.execute(
            "SELECT t.name FROM knowledge_tags t JOIN knowledge_article_tags atg ON atg.tag_id=t.id WHERE atg.article_id=? ORDER BY t.name",
            (identity,),
        )
    ]
    article["sources"] = []
    for source in conn.execute(
        "SELECT s.*,p.name,p.print_date,p.status AS print_status FROM knowledge_sources s JOIN prints p ON p.id=s.print_id WHERE s.article_id=? ORDER BY p.print_date DESC,p.id DESC",
        (identity,),
    ).fetchall():
        source = dict(source)
        source["materials"] = [
            r["material"]
            for r in conn.execute(
                "SELECT DISTINCT f.material FROM consumption c JOIN filaments f ON f.id=c.filament_id WHERE c.print_id=? ORDER BY f.material",
                (source["print_id"],),
            )
        ]
        article["sources"].append(source)
    return article


def save_article(conn, payload, identity=None):
    if not isinstance(payload, dict):
        raise TypeError("Ugyldig artikel.")
    values = []
    for field in TEXT_FIELDS:
        value = payload.get(field, "")
        if not isinstance(value, str) or len(value) > (
            200 if field == "title" else 5000
        ):
            raise ValueError("Artikelteksten er for lang eller ugyldig.")
        values.append(value.strip())
    if not values[0]:
        raise ValueError("Angiv en titel.")
    category = payload.get("category_id")
    if (
        type(category) is not int
        or not conn.execute(
            "SELECT id FROM knowledge_categories WHERE id=?", (category,)
        ).fetchone()
    ):
        raise ValueError("Vælg en gyldig kategori.")
    confidence = payload.get("confidence", "observation")
    status = payload.get("status", "draft")
    if confidence not in ("observation", "hypothesis", "verified") or status not in (
        "draft",
        "published",
        "archived",
    ):
        raise ValueError("Ugyldig evidensklasse eller status.")
    origin = payload.get("origin", "manual")
    if origin not in ("manual", "ai_assisted"):
        raise ValueError("Ugyldig artikeloprindelse.")
    if (
        identity is None
        and origin == "ai_assisted"
        and payload.get("approve_ai") is not True
    ):
        raise ValueError("Gennemgå og godkend AI-forslaget, før artiklen gemmes.")
    previous = get_article(conn, identity) if identity is not None else None
    if identity is not None and previous is None:
        raise ValueError("Artiklen findes ikke.")
    if (
        confidence == "verified"
        and (previous is None or previous["confidence"] != "verified")
        and payload.get("confirm_verified") is not True
    ):
        raise ValueError("Bekræft udtrykkeligt, at fundet er verificeret.")
    tags = payload.get("tags", [])
    sources = payload.get("sources", [])
    if (
        not isinstance(tags, list)
        or len(tags) > 20
        or any(not isinstance(t, str) or not t.strip() or len(t) > 100 for t in tags)
    ):
        raise ValueError("Angiv højst 20 tags på højst 100 tegn.")
    if not isinstance(sources, list) or len(sources) > 100:
        raise ValueError("Angiv højst 100 printkilder.")
    seen = set()
    for source in sources:
        if not isinstance(source, dict) or type(source.get("print_id")) is not int:
            raise ValueError("Ugyldig printkilde.")
        if (
            source["print_id"] in seen
            or not conn.execute(
                "SELECT id FROM prints WHERE id=?", (source["print_id"],)
            ).fetchone()
        ):
            raise ValueError("Printkilden mangler eller er valgt flere gange.")
        seen.add(source["print_id"])
        if (
            not isinstance(source.get("note", ""), str)
            or len(source.get("note", "")) > 2000
            or source.get("relationship_type", "source")
            not in ("source", "test", "confirmation")
        ):
            raise ValueError("Ugyldig kildeforklaring eller relationstype.")
    now = datetime.now(UTC).isoformat(timespec="seconds")
    published = previous["published_at"] if previous else None
    if status == "published" and not published:
        published = now
    if identity is None:
        identity = conn.execute(
            "INSERT INTO knowledge_articles (title,summary,observation,possible_cause,resolution,lessons_learned,category_id,confidence,status,origin,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (*values, category, confidence, status, origin, now, now, published),
        ).lastrowid
    else:
        conn.execute(
            "UPDATE knowledge_articles SET title=?,summary=?,observation=?,possible_cause=?,resolution=?,lessons_learned=?,category_id=?,confidence=?,status=?,updated_at=?,published_at=? WHERE id=?",
            (*values, category, confidence, status, now, published, identity),
        )
    conn.execute("DELETE FROM knowledge_article_tags WHERE article_id=?", (identity,))
    conn.execute("DELETE FROM knowledge_sources WHERE article_id=?", (identity,))
    for tag in {t.strip().casefold(): t.strip() for t in tags}.values():
        row = conn.execute(
            "SELECT id FROM knowledge_tags WHERE LOWER(name)=LOWER(?)", (tag,)
        ).fetchone()
        tag_id = (
            row["id"]
            if row
            else conn.execute(
                "INSERT INTO knowledge_tags (name) VALUES (?)", (tag,)
            ).lastrowid
        )
        conn.execute(
            "INSERT INTO knowledge_article_tags (article_id,tag_id) VALUES (?,?)",
            (identity, tag_id),
        )
    for source in sources:
        conn.execute(
            "INSERT INTO knowledge_sources (article_id,print_id,note,relationship_type) VALUES (?,?,?,?)",
            (
                identity,
                source["print_id"],
                source.get("note", ""),
                source.get("relationship_type", "source"),
            ),
        )
    return identity


def list_articles(conn, filters):
    clauses, params = [], []
    query = filters.get("q", [""])[0].strip()
    if len(query) > 200:
        raise ValueError("Søgningen må højst være 200 tegn.")
    if query:
        # Literal LIKE fallback also covers short technical terms and stopwords.
        pattern = (
            "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
        )
        like = " OR ".join(
            f"LOWER(a.{field}) LIKE LOWER(?) ESCAPE '!'" for field in TEXT_FIELDS
        )
        like += " OR EXISTS (SELECT 1 FROM knowledge_article_tags atg JOIN knowledge_tags t ON t.id=atg.tag_id WHERE atg.article_id=a.id AND LOWER(t.name) LIKE LOWER(?) ESCAPE '!')"
        if os.environ.get("DATABASE_BACKEND", "sqlite") == "mysql":
            like = (
                "MATCH(a.title,a.summary,a.observation,a.possible_cause,a.resolution,a.lessons_learned) AGAINST (? IN NATURAL LANGUAGE MODE) OR "
                + like
            )
            params.append(query)
        clauses.append("(" + like + ")")
        params.extend([pattern] * (len(TEXT_FIELDS) + 1))
    for field in ("category_id", "confidence", "status"):
        value = filters.get(field, [""])[0]
        if value:
            clauses.append(f"a.{field}=?")
            params.append(value)
    for field, sql in (
        (
            "tag",
            "EXISTS (SELECT 1 FROM knowledge_article_tags atg JOIN knowledge_tags t ON t.id=atg.tag_id WHERE atg.article_id=a.id AND LOWER(t.name)=LOWER(?))",
        ),
        (
            "material",
            "EXISTS (SELECT 1 FROM knowledge_sources s JOIN consumption c ON c.print_id=s.print_id JOIN filaments f ON f.id=c.filament_id WHERE s.article_id=a.id AND f.material=?)",
        ),
    ):
        value = filters.get(field, [""])[0]
        if value:
            clauses.append(sql)
            params.append(value)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    ids = conn.execute(
        "SELECT a.id FROM knowledge_articles a"
        + where
        + " ORDER BY a.updated_at DESC,a.id DESC",
        params,
    ).fetchall()
    return [get_article(conn, row["id"]) for row in ids]
