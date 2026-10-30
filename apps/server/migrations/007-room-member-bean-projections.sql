-- The legacy room member score was a writable copy of settled beans.  Verify it
-- before removal so an upgrade never silently changes an archived record.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM room_members AS member
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(entry.amount), 0)::numeric AS settlement_beans
      FROM ledger_operations AS operation
      JOIN ledger_entries AS entry ON entry.operation_id = operation.id
      WHERE operation.kind = 'round_settlement'
        AND operation.room_id = member.room_id
        AND entry.user_id = member.user_id
    ) AS derived ON true
    WHERE member.score IS DISTINCT FROM derived.settlement_beans
  ) THEN
    RAISE EXCEPTION 'Cannot remove room_members.score because it differs from immutable round settlement entries';
  END IF;
END;
$$;

ALTER TABLE room_members DROP COLUMN score;

CREATE INDEX ledger_round_settlement_room ON ledger_operations(room_id, id)
  WHERE kind = 'round_settlement';

CREATE VIEW room_member_settlement_totals AS
  SELECT operation.room_id,
         entry.user_id,
         SUM(entry.amount)::numeric AS room_bean_delta
  FROM ledger_operations AS operation
  JOIN ledger_entries AS entry ON entry.operation_id = operation.id
  WHERE operation.kind = 'round_settlement'
  GROUP BY operation.room_id, entry.user_id;
