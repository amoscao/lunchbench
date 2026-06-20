-- Sample seed data for local development

INSERT INTO lunches (name, rating, glicko_rd, glicko_volatility, conservative_rating) VALUES
  ('Margherita Pizza', 1500.0, 350.0, 0.06, 800.0),
  ('Chicken Tacos', 1500.0, 350.0, 0.06, 800.0),
  ('Caesar Salad', 1500.0, 350.0, 0.06, 800.0),
  ('BLT Sandwich', 1500.0, 350.0, 0.06, 800.0),
  ('Veggie Burrito', 1500.0, 350.0, 0.06, 800.0);
