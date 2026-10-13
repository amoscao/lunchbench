-- Flag every existing lunch as a Paula legacy lunch. New lunches default to 0.
ALTER TABLE lunches ADD COLUMN is_legacy INTEGER NOT NULL DEFAULT 0;
UPDATE lunches SET is_legacy = 1;
