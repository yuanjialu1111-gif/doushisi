-- 第三轮 R5：系统桌一场打完同桌号接着开下一场。match_seq 是第几场，previous_room_id 指上一场；
-- hold_until 不为空表示上一场的人座位还留着、还没点「再来一局」，过时没点就空出来。只加不删。
ALTER TABLE rooms ADD COLUMN match_seq integer NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN previous_room_id uuid REFERENCES rooms(id);
ALTER TABLE room_members ADD COLUMN hold_until timestamptz;
