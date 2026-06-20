-- Align future lunch defaults with Glicko-2 starting values.
-- SQLite cannot alter a column default in place, so rebuild lunches.
-- Rebuild votes too because its foreign keys reference lunches.
-- This migration repairs schema defaults and obvious legacy 1000-baseline rows.
-- It does not replay mixed historical Glicko games; exact replay needs an
-- approved data repair command because Glicko is application logic, not SQL.

BEGIN TRANSACTION;
PRAGMA defer_foreign_keys=ON;

ALTER TABLE lunches RENAME TO lunches_old;

CREATE TABLE lunches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_key TEXT,
  rating REAL NOT NULL DEFAULT 1500.0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT,
  is_vegan INTEGER NOT NULL DEFAULT 0,
  glicko_rd REAL NOT NULL DEFAULT 350.0,
  glicko_volatility REAL NOT NULL DEFAULT 0.06,
  conservative_rating REAL NOT NULL DEFAULT 800.0
);

INSERT INTO lunches (
  id,
  name,
  image_key,
  rating,
  wins,
  losses,
  ties,
  created_at,
  updated_at,
  description,
  is_vegan,
  glicko_rd,
  glicko_volatility,
  conservative_rating
)
SELECT
  id,
  name,
  image_key,
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM votes v
      WHERE (v.left_lunch_id = lunches_old.id OR v.right_lunch_id = lunches_old.id)
        AND v.left_lunch_id <> v.right_lunch_id
    )
      AND EXISTS (
        SELECT 1
        FROM votes v
        WHERE v.left_lunch_id = lunches_old.id OR v.right_lunch_id = lunches_old.id
      )
    THEN 1500.0
    WHEN EXISTS (
      SELECT 1
      FROM votes v
      WHERE (
        v.left_lunch_id = lunches_old.id
        AND v.left_lunch_id <> v.right_lunch_id
        AND v.left_rating_before = 1000.0
        AND v.id = (
          SELECT MIN(v2.id)
          FROM votes v2
          WHERE (v2.left_lunch_id = lunches_old.id OR v2.right_lunch_id = lunches_old.id)
            AND v2.left_lunch_id <> v2.right_lunch_id
        )
      ) OR (
        v.right_lunch_id = lunches_old.id
        AND v.left_lunch_id <> v.right_lunch_id
        AND v.right_rating_before = 1000.0
        AND v.id = (
          SELECT MIN(v2.id)
          FROM votes v2
          WHERE (v2.left_lunch_id = lunches_old.id OR v2.right_lunch_id = lunches_old.id)
            AND v2.left_lunch_id <> v2.right_lunch_id
        )
      )
    )
    THEN rating + 500.0
    WHEN rating = 1000.0
      AND wins = 0
      AND losses = 0
      AND ties = 0
      AND glicko_rd = 350.0
      AND glicko_volatility = 0.06
      AND conservative_rating = 800.0
    THEN 1500.0
    ELSE rating
  END,
  wins,
  losses,
  ties,
  created_at,
  updated_at,
  description,
  is_vegan,
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM votes v
      WHERE (v.left_lunch_id = lunches_old.id OR v.right_lunch_id = lunches_old.id)
        AND v.left_lunch_id <> v.right_lunch_id
    )
      AND EXISTS (
        SELECT 1
        FROM votes v
        WHERE v.left_lunch_id = lunches_old.id OR v.right_lunch_id = lunches_old.id
      )
    THEN 350.0
    ELSE glicko_rd
  END,
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM votes v
      WHERE (v.left_lunch_id = lunches_old.id OR v.right_lunch_id = lunches_old.id)
        AND v.left_lunch_id <> v.right_lunch_id
    )
      AND EXISTS (
        SELECT 1
        FROM votes v
        WHERE v.left_lunch_id = lunches_old.id OR v.right_lunch_id = lunches_old.id
      )
    THEN 0.06
    ELSE glicko_volatility
  END,
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM votes v
      WHERE (v.left_lunch_id = lunches_old.id OR v.right_lunch_id = lunches_old.id)
        AND v.left_lunch_id <> v.right_lunch_id
    )
      AND EXISTS (
        SELECT 1
        FROM votes v
        WHERE v.left_lunch_id = lunches_old.id OR v.right_lunch_id = lunches_old.id
      )
    THEN 800.0
    WHEN EXISTS (
      SELECT 1
      FROM votes v
      WHERE (
        v.left_lunch_id = lunches_old.id
        AND v.left_lunch_id <> v.right_lunch_id
        AND v.left_rating_before = 1000.0
        AND v.id = (
          SELECT MIN(v2.id)
          FROM votes v2
          WHERE (v2.left_lunch_id = lunches_old.id OR v2.right_lunch_id = lunches_old.id)
            AND v2.left_lunch_id <> v2.right_lunch_id
        )
      ) OR (
        v.right_lunch_id = lunches_old.id
        AND v.left_lunch_id <> v.right_lunch_id
        AND v.right_rating_before = 1000.0
        AND v.id = (
          SELECT MIN(v2.id)
          FROM votes v2
          WHERE (v2.left_lunch_id = lunches_old.id OR v2.right_lunch_id = lunches_old.id)
            AND v2.left_lunch_id <> v2.right_lunch_id
        )
      )
    )
    THEN conservative_rating + 500.0
    WHEN rating = 1000.0
      AND wins = 0
      AND losses = 0
      AND ties = 0
      AND glicko_rd = 350.0
      AND glicko_volatility = 0.06
      AND conservative_rating = 800.0
    THEN 800.0
    ELSE conservative_rating
  END
FROM lunches_old;

CREATE TABLE votes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  left_lunch_id INTEGER NOT NULL REFERENCES lunches(id),
  right_lunch_id INTEGER NOT NULL REFERENCES lunches(id),
  result TEXT NOT NULL CHECK(result IN ('left_win', 'right_win', 'tie')),
  left_rating_before REAL NOT NULL,
  right_rating_before REAL NOT NULL,
  left_rating_after REAL NOT NULL,
  right_rating_after REAL NOT NULL,
  voter_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(left_lunch_id <> right_lunch_id)
);

INSERT INTO votes_new (
  id,
  left_lunch_id,
  right_lunch_id,
  result,
  left_rating_before,
  right_rating_before,
  left_rating_after,
  right_rating_after,
  voter_key,
  created_at
)
SELECT
  id,
  left_lunch_id,
  right_lunch_id,
  result,
  left_rating_before,
  right_rating_before,
  left_rating_after,
  right_rating_after,
  voter_key,
  created_at
FROM votes
WHERE left_lunch_id <> right_lunch_id;

DROP TABLE votes;
ALTER TABLE votes_new RENAME TO votes;

CREATE INDEX IF NOT EXISTS idx_votes_left_lunch ON votes(left_lunch_id);
CREATE INDEX IF NOT EXISTS idx_votes_right_lunch ON votes(right_lunch_id);

UPDATE lunches
SET
  wins = (
    SELECT COUNT(*)
    FROM votes
    WHERE (left_lunch_id = lunches.id AND result = 'left_win')
      OR (right_lunch_id = lunches.id AND result = 'right_win')
  ),
  losses = (
    SELECT COUNT(*)
    FROM votes
    WHERE (left_lunch_id = lunches.id AND result = 'right_win')
      OR (right_lunch_id = lunches.id AND result = 'left_win')
  ),
  ties = (
    SELECT COUNT(*)
    FROM votes
    WHERE (left_lunch_id = lunches.id OR right_lunch_id = lunches.id)
      AND result = 'tie'
  );

DROP TABLE lunches_old;

CREATE INDEX IF NOT EXISTS idx_lunches_rating ON lunches(rating DESC);
CREATE INDEX IF NOT EXISTS idx_lunches_leaderboard ON lunches(conservative_rating DESC, name ASC, id ASC);

COMMIT;
