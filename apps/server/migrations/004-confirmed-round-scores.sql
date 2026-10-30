ALTER TABLE rounds ADD COLUMN scoring_version integer NOT NULL DEFAULT 0 CHECK (scoring_version IN (0, 1));
ALTER TABLE rounds ALTER COLUMN scoring_version SET DEFAULT 1;
ALTER TABLE rounds ADD COLUMN end_reason text CHECK (end_reason IN ('completed', 'dissolved'));

CREATE TABLE round_score_events (
  round_id uuid NOT NULL REFERENCES rounds(id),
  event_id text NOT NULL CHECK (event_id ~ '^[A-Za-z0-9_:-]{1,100}$'),
  room_id uuid NOT NULL REFERENCES rooms(id),
  command_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  postings jsonb NOT NULL CHECK (jsonb_typeof(postings) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, event_id),
  UNIQUE (round_id, command_id, ordinal),
  FOREIGN KEY (room_id, command_id) REFERENCES game_events(room_id, command_id)
);
CREATE TRIGGER round_score_events_immutable BEFORE UPDATE OR DELETE ON round_score_events
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER round_score_events_no_truncate BEFORE TRUNCATE ON round_score_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();

CREATE FUNCTION protect_round_scoring() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scoring_version IS DISTINCT FROM OLD.scoring_version THEN
    RAISE EXCEPTION 'Round scoring version is immutable';
  END IF;
  IF OLD.state = 'settled' AND (
    NEW.state IS DISTINCT FROM OLD.state OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR
    NEW.results IS DISTINCT FROM OLD.results OR NEW.end_reason IS DISTINCT FROM OLD.end_reason
  ) THEN
    RAISE EXCEPTION 'Settled round results are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER round_scoring_immutable BEFORE UPDATE ON rounds
  FOR EACH ROW EXECUTE FUNCTION protect_round_scoring();
