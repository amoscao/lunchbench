-- Sample seed data for local development
-- created_at is backdated so sample lunches do not show the "New" badge (<7 days old).

INSERT INTO lunches (name, rating, glicko_rd, glicko_volatility, conservative_rating, is_legacy, created_at, updated_at) VALUES
  ('Margherita Pizza', 1500.0, 350.0, 0.06, 800.0, 1, '2024-09-01 12:00:00', '2024-09-01 12:00:00'),
  ('Chicken Tacos', 1500.0, 350.0, 0.06, 800.0, 0, '2024-09-01 12:00:00', '2024-09-01 12:00:00'),
  ('Caesar Salad', 1500.0, 350.0, 0.06, 800.0, 0, '2024-09-01 12:00:00', '2024-09-01 12:00:00'),
  ('BLT Sandwich', 1500.0, 350.0, 0.06, 800.0, 0, '2024-09-01 12:00:00', '2024-09-01 12:00:00'),
  ('Veggie Burrito', 1500.0, 350.0, 0.06, 800.0, 0, '2024-09-01 12:00:00', '2024-09-01 12:00:00');

-- Sample Sodabench drinks (8 sodas, 6 seltzers). Rows and image keys match migrations/0012_soda_catalog.sql.
-- E2E uploads placeholder images for these keys from scripts/data/seed-images.
INSERT OR IGNORE INTO sodas (walmart_item_id, brand, flavor, type, image_key) VALUES
  ('12166733', 'Coca-Cola', 'Original', 'soda', 'images/bac1105a-e4ee-5d1f-be5b-71989b66f945.jpg'),
  ('10291651', 'Coca-Cola', 'Zero Sugar', 'soda', 'images/37c285cf-64f7-56ad-8e66-b30eca3e41ad.jpg'),
  ('10452492', 'Dr Pepper', 'Original', 'soda', 'images/5445ff79-cfc1-5e1e-85e6-d162051fa109.jpg'),
  ('10291611', 'Sprite', 'Original', 'soda', 'images/73a26095-0736-5202-b81e-36783960cecf.jpg'),
  ('100175342', 'Canada Dry', 'Ginger Ale Caffeine-Free', 'soda', 'images/96c25a56-aff8-5e3f-966d-cd9bb41d1749.jpg'),
  ('16777401', 'A&W', 'Root Beer', 'soda', 'images/47e021a2-160e-5613-abf1-6224b2b2f0f3.jpg'),
  ('1695005554', 'poppi', 'Strawberry Lemon', 'soda', 'images/fdbb8063-1f25-50f5-838e-7d4de5480b2d.jpg'),
  ('2444526495', 'Zevia', 'Cola', 'soda', 'images/94320218-b23f-5046-8c5d-43801c741419.jpg'),
  ('490194997', 'bubly', 'Grapefruit', 'seltzer', 'images/419f1ff4-c34f-5370-a5e8-19dcfbafb868.jpg'),
  ('36333049', 'LaCroix', 'Lime', 'seltzer', 'images/7ea3bd53-a7c8-5154-8b1d-319c6d16d20c.png'),
  ('342409802', 'Polar', 'Original', 'seltzer', 'images/67d35bc6-51bc-5e24-aa4f-ea66b0ee26ea.jpg'),
  ('760423502', 'Waterloo', 'Summer Berry', 'seltzer', 'images/527e9d1c-a00a-5e33-877f-f819d561610d.jpg'),
  ('36334353', 'LaCroix', 'Coconut', 'seltzer', 'images/8b7f8cde-13b0-593d-a434-997a78d4f2b0.jpg'),
  ('2841113791', 'Polar', 'Orange Vanilla', 'seltzer', 'images/726ffa73-3815-52d9-b863-105345504a04.jpg');
