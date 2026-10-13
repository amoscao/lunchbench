-- Sample seed data for local development
-- created_at is backdated so sample lunches do not show the "New" badge (<7 days old).

INSERT INTO lunches (name, rating, glicko_rd, glicko_volatility, conservative_rating, is_legacy, created_at, updated_at) VALUES
  ('Margherita Pizza', 1500.0, 350.0, 0.06, 800.0, 1, '2024-09-01 12:00:00', '2024-09-01 12:00:00'),
  ('Chicken Tacos', 1500.0, 350.0, 0.06, 800.0, 1, '2024-09-01 12:00:00', '2024-09-01 12:00:00'),
  ('Caesar Salad', 1500.0, 350.0, 0.06, 800.0, 1, '2024-09-01 12:00:00', '2024-09-01 12:00:00'),
  ('BLT Sandwich', 1500.0, 350.0, 0.06, 800.0, 0, '2024-09-01 12:00:00', '2024-09-01 12:00:00'),
  ('Veggie Burrito', 1500.0, 350.0, 0.06, 800.0, 0, '2024-09-01 12:00:00', '2024-09-01 12:00:00');
