-- Add Glicko-2 columns to lunches
ALTER TABLE lunches ADD COLUMN glicko_rd          REAL NOT NULL DEFAULT 350.0;
ALTER TABLE lunches ADD COLUMN glicko_volatility  REAL NOT NULL DEFAULT 0.06;
ALTER TABLE lunches ADD COLUMN conservative_rating REAL NOT NULL DEFAULT 800.0;

-- Reset all scores: keep dishes, wipe ratings and votes
UPDATE lunches SET
  rating               = 1500.0,
  glicko_rd            = 350.0,
  glicko_volatility    = 0.06,
  conservative_rating  = 800.0,
  wins                 = 0,
  losses               = 0,
  ties                 = 0;

DELETE FROM votes;
DELETE FROM rate_limits WHERE action = 'vote';
