CREATE SCHEMA IF NOT EXISTS gallery;

CREATE TABLE IF NOT EXISTS gallery.tags (
    id    SERIAL PRIMARY KEY,
    slug  TEXT NOT NULL UNIQUE,
    name  TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#c8a84b'
);

CREATE TABLE IF NOT EXISTS gallery.reviews (
    id             SERIAL PRIMARY KEY,
    ozon_review_id TEXT NOT NULL UNIQUE,
    product_id     BIGINT,
    product_name   TEXT,
    product_url    TEXT,
    rating         SMALLINT,
    review_text    TEXT,
    author_name    TEXT,
    photos         JSONB NOT NULL DEFAULT '[]',
    videos         JSONB NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    ai_title       TEXT,
    ai_tags        TEXT[] NOT NULL DEFAULT '{}',
    ai_score       SMALLINT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_status  ON gallery.reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON gallery.reviews(created_at DESC);

CREATE TABLE IF NOT EXISTS gallery.collection_items (
    id           SERIAL PRIMARY KEY,
    review_id    INTEGER NOT NULL REFERENCES gallery.reviews(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    cover_url    TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gallery.collection_item_tags (
    item_id INTEGER NOT NULL REFERENCES gallery.collection_items(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES gallery.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

CREATE OR REPLACE FUNCTION gallery.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_updated ON gallery.reviews;
CREATE TRIGGER trg_reviews_updated
    BEFORE UPDATE ON gallery.reviews
    FOR EACH ROW EXECUTE FUNCTION gallery.set_updated_at();

INSERT INTO gallery.tags (slug, name, color) VALUES
    ('furniture','Мебель','#c8a84b'),('decor','Декор','#8a6f2e'),
    ('toy','Игрушки','#e2c978'),('kitchen','Кухня','#c8a84b'),
    ('frame','Рамки','#8a6f2e'),('box','Шкатулки','#e2c978'),
    ('shelf','Полки','#c8a84b'),('lamp','Светильники','#8a6f2e'),
    ('art','Арт/резьба','#e2c978'),('outdoor','Для улицы','#c8a84b')
ON CONFLICT (slug) DO NOTHING;
