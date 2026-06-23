CREATE TABLE matchup_sessions (
  session_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE matchup_presentations (
  session_key TEXT NOT NULL REFERENCES matchup_sessions(session_key),
  vegan_only INTEGER NOT NULL CHECK (vegan_only IN (0, 1)),
  low_lunch_id INTEGER NOT NULL,
  high_lunch_id INTEGER NOT NULL,
  presented_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_key, vegan_only, low_lunch_id, high_lunch_id),
  CHECK (low_lunch_id < high_lunch_id)
);

CREATE INDEX idx_matchup_presentations_session_mode
ON matchup_presentations(session_key, vegan_only);

CREATE TABLE matchup_tokens (
  token TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES matchup_sessions(session_key),
  vegan_only INTEGER NOT NULL CHECK (vegan_only IN (0, 1)),
  low_lunch_id INTEGER NOT NULL,
  high_lunch_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (low_lunch_id < high_lunch_id)
);
