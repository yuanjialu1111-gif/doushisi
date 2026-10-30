ALTER TABLE rounds ADD COLUMN initial_snapshot jsonb;
CREATE INDEX game_events_round ON game_events(room_id, (payload->>'roundId'), sequence);

CREATE FUNCTION protect_round_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.initial_snapshot IS DISTINCT FROM OLD.initial_snapshot THEN
    RAISE EXCEPTION 'Round origin is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER round_origin_immutable BEFORE UPDATE ON rounds
  FOR EACH ROW EXECUTE FUNCTION protect_round_origin();
