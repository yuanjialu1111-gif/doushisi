-- 大厅公开桌、首次资料设置、头像（DEC-20261030）。只加不删，旧程序仍可运行。
ALTER TABLE accounts DROP CONSTRAINT accounts_role_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK (role IN ('player', 'beans_admin', 'deal_admin', 'system'));
ALTER TABLE accounts ADD COLUMN avatar_hash text CHECK (avatar_hash ~ '^[0-9a-f]{32}$');
ALTER TABLE accounts ADD COLUMN avatar_status text NOT NULL DEFAULT 'none' CHECK (avatar_status IN ('none', 'active', 'rejected'));
ALTER TABLE accounts ADD COLUMN sex smallint NOT NULL DEFAULT 0 CHECK (sex IN (0, 1, 2));
ALTER TABLE accounts ADD COLUMN profile_completed_at timestamptz;
ALTER TABLE accounts ADD COLUMN nickname_changed_at timestamptz;
ALTER TABLE accounts ADD COLUMN nickname_rejected boolean NOT NULL DEFAULT false;
-- 只约束已设好资料的人，老账号重名不会让迁移失败。
CREATE UNIQUE INDEX profile_nicknames ON accounts (lower(nickname)) WHERE profile_completed_at IS NOT NULL;

CREATE TABLE account_avatars (
  account_id uuid NOT NULL REFERENCES accounts(id),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{32}$'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 262144),
  created_at timestamptz NOT NULL DEFAULT now(),
  rejected_at timestamptz,
  PRIMARY KEY (account_id, hash)
);

CREATE TABLE lobby_templates (
  id uuid PRIMARY KEY,
  variant_key text NOT NULL,
  options jsonb NOT NULL,
  region jsonb,
  standing_empty integer NOT NULL DEFAULT 3 CHECK (standing_empty BETWEEN 0 AND 20),
  threshold_multiplier integer NOT NULL DEFAULT 10 CHECK (threshold_multiplier BETWEEN 1 AND 1000),
  idle_clear_minutes integer NOT NULL DEFAULT 10 CHECK (idle_clear_minutes BETWEEN 1 AND 120),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rooms ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public'));
ALTER TABLE rooms ADD COLUMN lobby_template_id uuid REFERENCES lobby_templates(id);
CREATE INDEX public_open_rooms ON rooms (variant_key) WHERE visibility = 'public' AND state <> 'closed';

-- 系统桌的房主：不能登录（密码字段不是 scrypt，账号停用），也不入座。
INSERT INTO accounts (id, username, nickname, password_hash, role, disabled)
VALUES ('00000000-0000-4000-8000-000000000001', 'system-lobby', '系统桌', 'disabled', 'system', true);
