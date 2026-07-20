import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  bigint,
} from "drizzle-orm/pg-core";

export const platform = pgSchema("platform");

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const principals = platform.table("principals", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  kind: text("kind").notNull(), // human | service
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sessions = platform.table("sessions", {
  id: text("id").primaryKey(),
  principalId: text("principal_id")
    .notNull()
    .references(() => principals.id),
  status: text("status").notNull(), // open | resumed | cancelled | closed
  workflowId: text("workflow_id"), // correlation only; never equal to session id
  version: integer("version").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const sessionMessages = platform.table("session_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const workflows = platform.table("workflows", {
  id: text("id").primaryKey(),
  principalId: text("principal_id")
    .notNull()
    .references(() => principals.id),
  kind: text("kind").notNull(), // order_fulfillment
  recoveryState: text("recovery_state").notNull(),
  version: integer("version").notNull().default(0),
  orderId: text("order_id"),
  temporalWorkflowId: text("temporal_workflow_id"),
  temporalRunId: text("temporal_run_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const workflowTransitions = platform.table("workflow_transitions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  versionAfter: integer("version_after").notNull(),
  reason: text("reason"),
  evidenceRef: text("evidence_ref"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const workflowLeases = platform.table("workflow_leases", {
  workflowId: text("workflow_id")
    .primaryKey()
    .references(() => workflows.id),
  ownerWorkerId: text("owner_worker_id").notNull(),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull(),
  expiresAt: ts("expires_at").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const operations = platform.table(
  "operations",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id),
    operationName: text("operation_name").notNull(),
    recoveryState: text("recovery_state").notNull(),
    version: integer("version").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    mutationKind: text("mutation_kind").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("operations_wf_idem_uidx").on(t.workflowId, t.idempotencyKey)],
);

export const operationAttempts = platform.table("operation_attempts", {
  id: text("id").primaryKey(),
  operationId: text("operation_id")
    .notNull()
    .references(() => operations.id),
  attemptNumber: integer("attempt_number").notNull(),
  workerId: text("worker_id"),
  fencingToken: bigint("fencing_token", { mode: "bigint" }),
  status: text("status").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

export const actionGrants = platform.table("action_grants", {
  id: text("id").primaryKey(),
  principalId: text("principal_id")
    .notNull()
    .references(() => principals.id),
  sessionId: text("session_id").references(() => sessions.id),
  workflowId: text("workflow_id").references(() => workflows.id),
  scope: text("scope").notNull(),
  kind: text("kind").notNull(), // execution | recovery
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const policyDecisions = platform.table("policy_decisions", {
  id: text("id").primaryKey(),
  principalId: text("principal_id"),
  grantId: text("grant_id"),
  decision: text("decision").notNull(), // allow | deny
  reason: text("reason").notNull(),
  policy: text("policy").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const effectLedgerEntries = platform.table("effect_ledger_entries", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id),
  operationId: text("operation_id")
    .notNull()
    .references(() => operations.id),
  attemptId: text("attempt_id")
    .notNull()
    .references(() => operationAttempts.id),
  idempotencyKey: text("idempotency_key").notNull(),
  externalReceiptId: text("external_receipt_id"),
  requestHash: text("request_hash").notNull(),
  responseHash: text("response_hash"),
  localExecutionState: text("local_execution_state").notNull(),
  observedExternalState: text("observed_external_state"),
  correlation: jsonb("correlation").$type<Record<string, string>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const externalReceipts = platform.table("external_receipts", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const reconciliationResults = platform.table("reconciliation_results", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id),
  operationId: text("operation_id")
    .notNull()
    .references(() => operations.id),
  classification: text("classification").notNull(),
  decision: text("decision").notNull(),
  evidenceRef: text("evidence_ref").notNull(),
  details: jsonb("details"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const compensationRecords = platform.table("compensation_records", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id),
  sourceOperationId: text("source_operation_id")
    .notNull()
    .references(() => operations.id),
  compensationOperationId: text("compensation_operation_id")
    .notNull()
    .references(() => operations.id),
  status: text("status").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const evidencePackets = platform.table("evidence_packets", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id),
  chainHeadHash: text("chain_head_hash").notNull(),
  hmacSignature: text("hmac_signature").notNull(),
  packet: jsonb("packet").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditEvents = platform.table("audit_events", {
  id: text("id").primaryKey(),
  actorPrincipalId: text("actor_principal_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  redactedPayload: jsonb("redacted_payload"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const schemaMigrations = platform.table("schema_migrations", {
  id: text("id").primaryKey(),
  appliedAt: ts("applied_at").notNull().defaultNow(),
  checksum: text("checksum").notNull(),
  success: boolean("success").notNull().default(true),
});
