CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.principals (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.sessions (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES platform.principals(id),
  status TEXT NOT NULL,
  workflow_id TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES platform.sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.workflows (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES platform.principals(id),
  kind TEXT NOT NULL,
  recovery_state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  order_id TEXT,
  temporal_workflow_id TEXT,
  temporal_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.workflow_transitions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES platform.workflows(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  version_after INTEGER NOT NULL,
  reason TEXT,
  evidence_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.workflow_leases (
  workflow_id TEXT PRIMARY KEY REFERENCES platform.workflows(id),
  owner_worker_id TEXT NOT NULL,
  fencing_token BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.operations (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES platform.workflows(id),
  operation_name TEXT NOT NULL,
  recovery_state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  mutation_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS operations_wf_idem_uidx
  ON platform.operations (workflow_id, idempotency_key);

CREATE TABLE IF NOT EXISTS platform.operation_attempts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES platform.operations(id),
  attempt_number INTEGER NOT NULL,
  worker_id TEXT,
  fencing_token BIGINT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform.action_grants (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES platform.principals(id),
  session_id TEXT REFERENCES platform.sessions(id),
  workflow_id TEXT REFERENCES platform.workflows(id),
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.policy_decisions (
  id TEXT PRIMARY KEY,
  principal_id TEXT,
  grant_id TEXT,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.effect_ledger_entries (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES platform.workflows(id),
  operation_id TEXT NOT NULL REFERENCES platform.operations(id),
  attempt_id TEXT NOT NULL REFERENCES platform.operation_attempts(id),
  idempotency_key TEXT NOT NULL,
  external_receipt_id TEXT,
  request_hash TEXT NOT NULL,
  response_hash TEXT,
  local_execution_state TEXT NOT NULL,
  observed_external_state TEXT,
  correlation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.external_receipts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.reconciliation_results (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES platform.workflows(id),
  operation_id TEXT NOT NULL REFERENCES platform.operations(id),
  classification TEXT NOT NULL,
  decision TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.compensation_records (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES platform.workflows(id),
  source_operation_id TEXT NOT NULL REFERENCES platform.operations(id),
  compensation_operation_id TEXT NOT NULL REFERENCES platform.operations(id),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.evidence_packets (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES platform.workflows(id),
  chain_head_hash TEXT NOT NULL,
  hmac_signature TEXT NOT NULL,
  packet JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.audit_events (
  id TEXT PRIMARY KEY,
  actor_principal_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  redacted_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true
);
