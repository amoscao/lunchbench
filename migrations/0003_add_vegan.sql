-- Add vegan flag to lunches
ALTER TABLE lunches ADD COLUMN is_vegan INTEGER NOT NULL DEFAULT 0;
