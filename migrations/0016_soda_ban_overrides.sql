-- Issue #298: admin unban override for auto-banned drinks.
-- A drink is auto-banned when SODA_BAN_HATES (5) distinct voters' latest report on it is a Hate.
-- An admin unban records the Hate count at that moment; the drink stays shown until its Hate count
-- reaches hates_at_override + SODA_BAN_HATES, so 5 new Hates are needed to ban it again.
-- Additive; the current Worker ignores this table.
CREATE TABLE soda_ban_overrides (
  soda_id INTEGER PRIMARY KEY REFERENCES sodas(id),
  hates_at_override INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
