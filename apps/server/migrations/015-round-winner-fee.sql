-- DEC-20261112-大赢家付房费：房费从「开房开局扣一次」改成「每局结算时由大赢家付」，一个房间会有多笔房费。
-- 原来的约束是一个房间只能一笔房费，改成一局最多一笔；以前开局扣的那笔没有 round_id，不受新约束影响。只放宽约束，不动数据。
DROP INDEX IF EXISTS one_room_fee;
CREATE UNIQUE INDEX one_round_fee ON ledger_operations(round_id) WHERE kind = 'room_fee' AND round_id IS NOT NULL;
