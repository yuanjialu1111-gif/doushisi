CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  nickname text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('player', 'beans_admin', 'deal_admin')),
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES accounts(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE wallets (
  user_id uuid PRIMARY KEY REFERENCES accounts(id),
  balance numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rooms (
  id uuid PRIMARY KEY,
  code text NOT NULL,
  owner_id uuid NOT NULL REFERENCES accounts(id),
  variant_key text NOT NULL,
  rule_version text NOT NULL,
  rules jsonb NOT NULL,
  player_count integer NOT NULL CHECK (player_count BETWEEN 2 AND 4),
  rounds integer NOT NULL CHECK (rounds IN (4, 8, 12)),
  fee_mode text NOT NULL CHECK (fee_mode IN ('aa', 'owner')),
  state text NOT NULL CHECK (state IN ('waiting', 'playing', 'between_rounds', 'closed')),
  current_round integer NOT NULL DEFAULT 0,
  fee_charged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX active_room_codes ON rooms(code) WHERE state <> 'closed';
CREATE TABLE room_members (
  room_id uuid NOT NULL REFERENCES rooms(id),
  user_id uuid NOT NULL REFERENCES accounts(id),
  seat integer NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  score numeric NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id, user_id),
  UNIQUE(room_id, seat)
);
CREATE TABLE rounds (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id),
  number integer NOT NULL,
  state text NOT NULL CHECK (state IN ('playing', 'settled', 'voided')),
  snapshot jsonb NOT NULL,
  policy_snapshot jsonb NOT NULL,
  results jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(room_id, number)
);
CREATE TABLE ledger_operations (
  id uuid PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('admin_add', 'admin_deduct', 'room_fee', 'round_settlement')),
  actor_id uuid REFERENCES accounts(id),
  room_id uuid REFERENCES rooms(id),
  round_id uuid REFERENCES rounds(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_room_fee ON ledger_operations(room_id) WHERE kind = 'room_fee';
CREATE UNIQUE INDEX one_round_settlement ON ledger_operations(round_id) WHERE kind = 'round_settlement';
CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES ledger_operations(id),
  user_id uuid NOT NULL REFERENCES accounts(id),
  amount numeric NOT NULL,
  balance_before numeric NOT NULL,
  balance_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (balance_after = balance_before + amount),
  UNIQUE(operation_id, user_id)
);
CREATE INDEX ledger_user_time ON ledger_entries(user_id, created_at DESC);
CREATE TABLE deal_policies (
  user_id uuid PRIMARY KEY REFERENCES accounts(id),
  enabled boolean NOT NULL DEFAULT false,
  probability numeric(5,2) NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id uuid REFERENCES accounts(id),
  user_id uuid REFERENCES accounts(id),
  kind text NOT NULL,
  request_key text UNIQUE,
  request_hash text,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE game_events (
  room_id uuid NOT NULL REFERENCES rooms(id),
  sequence bigint NOT NULL,
  actor_id uuid REFERENCES accounts(id),
  command_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id, sequence),
  UNIQUE(room_id, command_id)
);
CREATE TABLE friends (
  user_id uuid NOT NULL REFERENCES accounts(id),
  friend_id uuid NOT NULL REFERENCES accounts(id),
  first_room_id uuid NOT NULL REFERENCES rooms(id),
  last_played_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, friend_id),
  CHECK(user_id <> friend_id)
);
CREATE TABLE dissolve_votes (
  room_id uuid NOT NULL REFERENCES rooms(id),
  user_id uuid NOT NULL REFERENCES accounts(id),
  agree boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id,user_id)
);
CREATE TABLE original_protocol_ids (
  wire_id integer GENERATED ALWAYS AS IDENTITY (START WITH 100000) UNIQUE,
  entity_kind text NOT NULL CHECK (entity_kind IN ('user','room','round')),
  entity_id uuid NOT NULL,
  PRIMARY KEY(entity_kind,entity_id)
);
CREATE TABLE original_protocol_regions (
  user_id uuid PRIMARY KEY REFERENCES accounts(id),
  shi_name text NOT NULL,
  xian_name text NOT NULL
);
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'History is append-only';
END;
$$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER ledger_operations_immutable BEFORE UPDATE OR DELETE ON ledger_operations
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER game_events_immutable BEFORE UPDATE OR DELETE ON game_events
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
