ALTER TABLE rounds ADD COLUMN state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0);

-- Existing accepted actions establish the version without rewriting archived events.
UPDATE rounds q SET state_version = (
  SELECT count(*)::integer FROM game_events e
  WHERE e.room_id=q.room_id AND e.payload->>'roundId'=q.id::text AND e.payload ? 'action'
);

CREATE FUNCTION protect_round_state_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state_version IS DISTINCT FROM OLD.state_version AND
    (OLD.state <> 'playing' OR NEW.state_version <> OLD.state_version + 1) THEN
    RAISE EXCEPTION 'Round state version must advance by one accepted action';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER round_state_version_monotonic BEFORE UPDATE ON rounds
  FOR EACH ROW EXECUTE FUNCTION protect_round_state_version();
