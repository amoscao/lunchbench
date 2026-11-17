-- Issue #296: take every OLIPOP drink off SodaArena.
-- Data only. Safe to re-run. Destructive for barcodes: it deletes every soda_barcodes row of these
-- drinks, including voter- and admin-learned ones.
-- Keyed by walmart_item_id (Cherry Cola, Classic Grape, Classic Root Beer, Cream Soda, Crisp Apple,
-- Orange Cream, Pomegranate Sparkle, Strawberry Vanilla, Vintage Cola) and brand.
-- Swipe and report history stays in place; inactive drinks are hidden everywhere.
-- Their R2 images are deleted separately (docs/deployment.md, "Remove OLIPOP"), so image_key is cleared here.
-- Re-running 0012 or 0014 later re-adds OLIPOP rows or mappings; run 0015 again after either.

UPDATE sodas
SET is_active = 0, image_key = NULL
WHERE brand = 'OLIPOP' AND walmart_item_id IN (
  '6925003428', '6921254024', '6925153849', '6919469917', '15779650088',
  '20068306279', '20233105269', '6921204598', '7097351727'
);

-- A scanned OLIPOP can now finds no mapping, so it falls through to manual search, is logged as
-- unknown, and voter learning can map the code to the drink picked instead.
DELETE FROM soda_barcodes
WHERE soda_id IN (
  SELECT id FROM sodas WHERE brand = 'OLIPOP' AND walmart_item_id IN (
    '6925003428', '6921254024', '6925153849', '6919469917', '15779650088',
    '20068306279', '20233105269', '6921204598', '7097351727'
  )
);
