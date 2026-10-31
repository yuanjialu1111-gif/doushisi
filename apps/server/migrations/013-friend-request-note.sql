-- 第二轮待确认 16：好友申请可带一句附言，只能从几句固定话里选（存编号，不存自由文字）；不选为空。只加不删。
ALTER TABLE friend_requests ADD COLUMN note smallint CHECK (note >= 0 AND note < 4);
