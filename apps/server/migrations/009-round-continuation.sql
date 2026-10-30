ALTER TABLE rounds ADD COLUMN next_round_context jsonb
  CHECK (next_round_context IS NULL OR jsonb_typeof(next_round_context) = 'object');

CREATE FUNCTION protect_round_continuation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'settled' AND NEW.next_round_context IS DISTINCT FROM OLD.next_round_context THEN
    RAISE EXCEPTION 'Settled round continuation is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER round_continuation_immutable BEFORE UPDATE ON rounds
  FOR EACH ROW EXECUTE FUNCTION protect_round_continuation();
