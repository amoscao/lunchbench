-- Speed vegan-scoped rank and leaderboard reads.
CREATE INDEX IF NOT EXISTS idx_lunches_vegan_leaderboard
ON lunches(is_vegan, conservative_rating DESC, name ASC, id ASC);
