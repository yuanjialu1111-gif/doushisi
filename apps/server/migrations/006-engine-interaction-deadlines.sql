ALTER TABLE room_members ADD COLUMN auto_play boolean NOT NULL DEFAULT false;
ALTER TABLE rounds ADD COLUMN interaction_state jsonb;
ALTER TABLE rounds ADD COLUMN initial_interaction_state jsonb;
ALTER TABLE rounds ADD COLUMN next_action_at timestamptz;
CREATE INDEX rounds_due_actions ON rounds(next_action_at, room_id)
  WHERE state='playing' AND next_action_at IS NOT NULL;

CREATE FUNCTION protect_round_interactions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.initial_interaction_state IS DISTINCT FROM OLD.initial_interaction_state THEN
    RAISE EXCEPTION 'Round interaction origin is immutable';
  END IF;
  IF OLD.state='settled' AND (NEW.interaction_state IS DISTINCT FROM OLD.interaction_state OR
    NEW.next_action_at IS DISTINCT FROM OLD.next_action_at) THEN
    RAISE EXCEPTION 'Settled round interaction history is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER round_interaction_history_immutable BEFORE UPDATE ON rounds
  FOR EACH ROW EXECUTE FUNCTION protect_round_interactions();
