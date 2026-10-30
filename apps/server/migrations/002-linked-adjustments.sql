ALTER TABLE ledger_operations
  ADD COLUMN reference_entry_id uuid REFERENCES ledger_entries(id),
  ADD CONSTRAINT linked_adjustments_are_manual
    CHECK (reference_entry_id IS NULL OR kind IN ('admin_add', 'admin_deduct'));
CREATE INDEX ledger_adjustment_reference ON ledger_operations(reference_entry_id)
  WHERE reference_entry_id IS NOT NULL;

CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER ledger_operations_no_truncate BEFORE TRUNCATE ON ledger_operations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER game_events_no_truncate BEFORE TRUNCATE ON game_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
