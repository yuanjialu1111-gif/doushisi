-- 第二轮：加好友、私聊、邀请入座、勋章、后台参数（DEC-20261031-好友 / 个人资料 / 第二轮开工）。只加不删，旧程序仍可运行。
-- 好友改成申请制后不再来自同桌，所以首次同桌房间可以为空；老好友保留。
ALTER TABLE friends ALTER COLUMN first_room_id DROP NOT NULL;

CREATE TABLE friend_requests (
  id uuid PRIMARY KEY,
  from_id uuid NOT NULL REFERENCES accounts(id),
  to_id uuid NOT NULL REFERENCES accounts(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (from_id <> to_id)
);
-- 同一方向同时只能有一条待处理申请。
CREATE UNIQUE INDEX friend_requests_pending_pair ON friend_requests (from_id, to_id) WHERE status = 'pending';
CREATE INDEX friend_requests_inbox ON friend_requests (to_id, status);
CREATE INDEX friend_requests_outbox ON friend_requests (from_id, created_at);

-- 私聊只存预设短语编号或表情编号，不存自由文字。
CREATE TABLE friend_messages (
  id uuid PRIMARY KEY,
  from_id uuid NOT NULL REFERENCES accounts(id),
  to_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('phrase', 'face', 'invite')),
  ref text NOT NULL CHECK (char_length(ref) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CHECK (from_id <> to_id)
);
CREATE INDEX friend_messages_inbox ON friend_messages (to_id, read_at);
CREATE INDEX friend_messages_pair ON friend_messages (from_id, to_id, created_at);

CREATE TABLE room_invites (
  id uuid PRIMARY KEY,
  from_id uuid NOT NULL REFERENCES accounts(id),
  to_id uuid NOT NULL REFERENCES accounts(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  result text CHECK (result IN ('joined', 'rejected', 'expired', 'full')),
  CHECK (from_id <> to_id)
);
CREATE INDEX room_invites_inbox ON room_invites (to_id, result);
CREATE INDEX room_invites_pair ON room_invites (from_id, to_id, created_at);

-- 勋章点亮后常亮，不因豆子减少而熄灭（DEC-20261031-战绩口径与勋章常亮）。
CREATE TABLE account_medals (
  account_id uuid NOT NULL REFERENCES accounts(id),
  medal text NOT NULL CHECK (medal ~ '^[a-z0-9_]{1,32}$'),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, medal)
);

-- 后台可改的业务参数；没有的键用代码里的默认值。
CREATE TABLE app_settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-zA-Z0-9_]{1,64}$'),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES accounts(id)
);
