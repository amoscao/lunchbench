-- Lunchbench initial schema

CREATE TABLE IF NOT EXISTS lunches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_key TEXT,
  rating REAL NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  left_lunch_id INTEGER NOT NULL REFERENCES lunches(id),
  right_lunch_id INTEGER NOT NULL REFERENCES lunches(id),
  result TEXT NOT NULL CHECK(result IN ('left_win', 'right_win', 'tie')),
  left_rating_before REAL NOT NULL,
  right_rating_before REAL NOT NULL,
  left_rating_after REAL NOT NULL,
  right_rating_after REAL NOT NULL,
  voter_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  PRIMARY KEY (key, action)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_votes_left_lunch ON votes(left_lunch_id);
CREATE INDEX IF NOT EXISTS idx_votes_right_lunch ON votes(right_lunch_id);
CREATE INDEX IF NOT EXISTS idx_lunches_rating ON lunches(rating DESC);
