-- Sodabench barcode scanning: barcode -> drink mappings and the unknown-scan log.

-- Codes are 13-digit GTINs: UPC-E expanded to UPC-A, UPC-A and EAN-8 zero-padded, check digit valid.
-- source: 'seed' (import script), 'voter' (learned from an unknown scan + manual report), 'admin'.
CREATE TABLE soda_barcodes (
  code TEXT PRIMARY KEY,
  soda_id INTEGER NOT NULL REFERENCES sodas(id),
  source TEXT NOT NULL CHECK (source IN ('seed', 'voter', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_soda_barcodes_soda ON soda_barcodes(soda_id);

-- One row per scan that matched no known barcode. resolved_soda_id is the drink the same voter then
-- reported manually (resolved_by = 'voter'), or the drink an admin mapped the code to ('admin').
-- session_key is never shown to admins; the admin view only counts distinct voters.
CREATE TABLE soda_unknown_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('upc_a', 'upc_e', 'ean_13', 'ean_8')),
  session_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_soda_id INTEGER REFERENCES sodas(id),
  resolved_by TEXT CHECK (resolved_by IN ('voter', 'admin'))
);

CREATE INDEX idx_soda_unknown_scans_code ON soda_unknown_scans(code, session_key);
CREATE INDEX idx_soda_unknown_scans_created ON soda_unknown_scans(created_at);
