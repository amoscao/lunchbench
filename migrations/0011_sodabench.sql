-- Sodabench: soda and seltzer catalog, voter swipes and reports, weekly order snapshots.

CREATE TABLE sodas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  walmart_item_id TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL,
  flavor TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('soda', 'seltzer')),
  image_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Latest swipe per voter per drink. right = like, left = not a like.
CREATE TABLE soda_swipes (
  session_key TEXT NOT NULL,
  soda_id INTEGER NOT NULL REFERENCES sodas(id),
  direction TEXT NOT NULL CHECK (direction IN ('right', 'left')),
  swiped_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_key, soda_id)
);

CREATE INDEX idx_soda_swipes_soda ON soda_swipes(soda_id);

-- Latest report per voter per drink. A newer report replaces the older one.
CREATE TABLE soda_reports (
  session_key TEXT NOT NULL,
  soda_id INTEGER NOT NULL REFERENCES sodas(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('like', 'hate')),
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_key, soda_id)
);

CREATE INDEX idx_soda_reports_soda ON soda_reports(soda_id);

-- Frozen weekly order list for the purchaser. week_start is the Monday (America/New_York), YYYY-MM-DD.
CREATE TABLE soda_buy_lists (
  week_start TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  items_json TEXT NOT NULL,
  params_json TEXT NOT NULL
);
