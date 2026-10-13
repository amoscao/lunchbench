-- Sample seed data for local development

INSERT INTO lunches (name, rating, glicko_rd, glicko_volatility, conservative_rating, is_legacy) VALUES
  ('Margherita Pizza', 1500.0, 350.0, 0.06, 800.0, 1),
  ('Chicken Tacos', 1500.0, 350.0, 0.06, 800.0, 1),
  ('Caesar Salad', 1500.0, 350.0, 0.06, 800.0, 1),
  ('BLT Sandwich', 1500.0, 350.0, 0.06, 800.0, 1),
  ('Veggie Burrito', 1500.0, 350.0, 0.06, 800.0, 1);
