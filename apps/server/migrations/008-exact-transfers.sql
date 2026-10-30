ALTER TABLE round_score_events ADD COLUMN transfers jsonb
  CHECK (transfers IS NULL OR jsonb_typeof(transfers) = 'array');
