-- Issue #296: take every OLIPOP drink off SodaArena.
-- Data only. Safe to re-run.
-- Keyed by walmart_item_id (Cherry Cola, Classic Grape, Classic Root Beer, Cream Soda, Crisp Apple,
-- Orange Cream, Pomegranate Sparkle, Strawberry Vanilla, Vintage Cola).
-- Swipe and report history stays in place; inactive drinks are hidden everywhere.
-- Their R2 images are deleted separately (keys are in the PR for #296), so image_key is cleared here.

-- A scanned OLIPOP can now finds no mapping, so it falls through to manual search and is logged as unknown.
DELETE FROM soda_barcodes
WHERE soda_id IN (
  SELECT id FROM sodas WHERE walmart_item_id IN (
    '6925003428', '6921254024', '6925153849', '6919469917', '15779650088',
    '20068306279', '20233105269', '6921204598', '7097351727'
  )
);

UPDATE sodas
SET is_active = 0, image_key = NULL
WHERE walmart_item_id IN (
  '6925003428', '6921254024', '6925153849', '6919469917', '15779650088',
  '20068306279', '20233105269', '6921204598', '7097351727'
);
