CREATE TABLE IF NOT EXISTS bible_verses (
  id      BIGSERIAL PRIMARY KEY,
  book    TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse   INTEGER NOT NULL,
  text    TEXT NOT NULL,
  UNIQUE (book, chapter, verse)
);
CREATE INDEX IF NOT EXISTS idx_bv_lookup   ON bible_verses (book, chapter, verse);
CREATE INDEX IF NOT EXISTS idx_bv_book_ch  ON bible_verses (book, chapter);
