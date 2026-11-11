CREATE SCHEMA IF NOT EXISTS dongxin;

CREATE TABLE dongxin.devices (
  id text PRIMARY KEY,
  model text NOT NULL,
  name text NOT NULL,
  firmware_version text,
  protocol text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capabilities) = 'object'),
  status text NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'FAULT')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE INDEX devices_model_status_idx ON dongxin.devices (model, status);
CREATE INDEX devices_updated_idx ON dongxin.devices (updated_at DESC, id ASC);
CREATE INDEX devices_last_seen_idx ON dongxin.devices (last_seen_at) WHERE last_seen_at IS NOT NULL;

CREATE TABLE dongxin.device_credentials (
  device_id text PRIMARY KEY REFERENCES dongxin.devices(id) ON DELETE RESTRICT,
  secret_hash bytea NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

CREATE TABLE dongxin.device_states (
  device_id text PRIMARY KEY REFERENCES dongxin.devices(id) ON DELETE RESTRICT,
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  control_revision bigint NOT NULL DEFAULT 0 CHECK (control_revision >= 0),
  reported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dongxin.device_commands (
  id uuid PRIMARY KEY,
  device_id text NOT NULL REFERENCES dongxin.devices(id) ON DELETE RESTRICT,
  intent text NOT NULL,
  slots jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(slots) = 'object'),
  status text NOT NULL CHECK (status IN ('QUEUED', 'APPLIED', 'REJECTED', 'NEEDS_CONFIRMATION', 'FAILED')),
  safety_decision text,
  speak text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX device_commands_pending_idx ON dongxin.device_commands (device_id, created_at)
  WHERE status = 'QUEUED';
CREATE INDEX device_commands_created_idx ON dongxin.device_commands (created_at);

CREATE TABLE dongxin.device_events (
  id uuid PRIMARY KEY,
  device_id text NOT NULL REFERENCES dongxin.devices(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_events_device_time_idx ON dongxin.device_events (device_id, created_at DESC);
CREATE INDEX device_events_retention_idx ON dongxin.device_events (created_at);

CREATE TABLE dongxin.voice_sessions (
  id uuid PRIMARY KEY,
  device_id text NOT NULL REFERENCES dongxin.devices(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX voice_sessions_device_time_idx ON dongxin.voice_sessions (device_id, updated_at DESC);
CREATE INDEX voice_sessions_retention_idx ON dongxin.voice_sessions (updated_at);

CREATE TABLE dongxin.voice_turns (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES dongxin.voice_sessions(id) ON DELETE CASCADE,
  input_text text NOT NULL,
  reply_text text NOT NULL,
  route text NOT NULL,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(usage) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX voice_turns_session_time_idx ON dongxin.voice_turns (session_id, created_at);
CREATE INDEX voice_turns_retention_idx ON dongxin.voice_turns (created_at);

CREATE TABLE dongxin.knowledge_sources (
  id text PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dongxin.knowledge_documents (
  id text PRIMARY KEY,
  source_id text REFERENCES dongxin.knowledge_sources(id) ON DELETE SET NULL,
  status text NOT NULL,
  scope text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_documents_publish_idx ON dongxin.knowledge_documents (status, scope);

CREATE TABLE dongxin.knowledge_revisions (
  document_id text NOT NULL REFERENCES dongxin.knowledge_documents(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, version)
);

CREATE TABLE dongxin.proactive_settings (
  scope_key text PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dongxin.staff_users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'EDITOR', 'REVIEWER')),
  password_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dongxin.audit_logs (
  id uuid PRIMARY KEY,
  actor_id uuid REFERENCES dongxin.staff_users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_time_idx ON dongxin.audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_time_idx ON dongxin.audit_logs (actor_id, created_at DESC);

CREATE TABLE dongxin.consumer_accounts (
  id uuid PRIMARY KEY,
  wechat_openid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dongxin.device_ownership (
  device_id text PRIMARY KEY REFERENCES dongxin.devices(id) ON DELETE RESTRICT,
  consumer_id uuid NOT NULL REFERENCES dongxin.consumer_accounts(id) ON DELETE RESTRICT,
  bound_at timestamptz NOT NULL DEFAULT now()
);
