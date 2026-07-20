import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { RepoContext } from "../repos/types.js";
import {
  effectLedgerEntries,
  externalReceipts,
} from "../schema/platform.js";
import { ReceiptRequiredError } from "./errors.js";
import { assertFencedWrite } from "./leases.js";
import { incrementMetric } from "./metrics.js";
import { insertAttempt } from "./operations.js";

export type LocalExecutionState =
  | "planned"
  | "dispatched"
  | "response_received"
  | "receipt_persisted"
  | "unknown"
  | "confirmed_success"
  | "confirmed_failure";

export interface LedgerRecordInput {
  workflowId: string;
  operationId: string;
  attemptId: string;
  attemptNumber: number;
  workerId: string;
  fencingToken: bigint;
  idempotencyKey: string;
  requestPayload: unknown;
  correlation?: Record<string, string>;
  localExecutionState?: LocalExecutionState;
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload ?? null))
    .digest("hex");
}

/**
 * Record a new attempt + ledger entry under a fenced lease (REQ-13).
 */
export async function recordAttempt(ctx: RepoContext, input: LedgerRecordInput) {
  await assertFencedWrite(
    ctx,
    input.workflowId,
    input.workerId,
    input.fencingToken,
  );

  await insertAttempt(ctx, {
    id: input.attemptId,
    operationId: input.operationId,
    attemptNumber: input.attemptNumber,
    workerId: input.workerId,
    fencingToken: input.fencingToken,
    status: "started",
    createdAt: new Date(),
  });

  const requestHash = hashPayload(input.requestPayload);
  const correlation = {
    workflowId: input.workflowId,
    operationId: input.operationId,
    attemptId: input.attemptId,
    workerId: input.workerId,
    fencingToken: input.fencingToken.toString(),
    idempotencyKey: input.idempotencyKey,
    ...input.correlation,
  };

  const entryId = randomUUID();
  const inserted = await ctx.db
    .insert(effectLedgerEntries)
    .values({
      id: entryId,
      workflowId: input.workflowId,
      operationId: input.operationId,
      attemptId: input.attemptId,
      idempotencyKey: input.idempotencyKey,
      externalReceiptId: null,
      requestHash,
      responseHash: null,
      localExecutionState: input.localExecutionState ?? "dispatched",
      observedExternalState: null,
      correlation,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return inserted[0]!;
}

export async function getLedgerEntry(ctx: RepoContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(effectLedgerEntries)
    .where(eq(effectLedgerEntries.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function persistExternalReceipt(
  ctx: RepoContext,
  args: {
    receiptId: string;
    provider: string;
    externalId: string;
    idempotencyKey: string;
    payload: unknown;
  },
) {
  const payloadHash = hashPayload(args.payload);
  const inserted = await ctx.db
    .insert(externalReceipts)
    .values({
      id: args.receiptId,
      provider: args.provider,
      externalId: args.externalId,
      idempotencyKey: args.idempotencyKey,
      payloadHash,
      payload: args.payload as Record<string, unknown>,
      createdAt: new Date(),
    })
    .returning();
  return inserted[0]!;
}

/**
 * Mark ledger entry confirmed_success only when an external receipt exists (REQ-16).
 */
export async function markConfirmedSuccess(
  ctx: RepoContext,
  args: {
    ledgerEntryId: string;
    workflowId: string;
    workerId: string;
    fencingToken: bigint;
    externalReceiptId: string;
    responsePayload: unknown;
    observedExternalState?: string;
  },
) {
  await assertFencedWrite(
    ctx,
    args.workflowId,
    args.workerId,
    args.fencingToken,
  );

  const receipts = await ctx.db
    .select()
    .from(externalReceipts)
    .where(eq(externalReceipts.id, args.externalReceiptId))
    .limit(1);

  if (receipts.length === 0) {
    incrementMetric("confirmed_without_receipt_rejected");
    throw new ReceiptRequiredError(
      `confirmed_success requires external receipt ${args.externalReceiptId}`,
    );
  }

  const updated = await ctx.db
    .update(effectLedgerEntries)
    .set({
      externalReceiptId: args.externalReceiptId,
      responseHash: hashPayload(args.responsePayload),
      localExecutionState: "confirmed_success",
      observedExternalState: args.observedExternalState ?? "confirmed_success",
      updatedAt: new Date(),
    })
    .where(eq(effectLedgerEntries.id, args.ledgerEntryId))
    .returning();

  return updated[0]!;
}

export async function markUnknown(
  ctx: RepoContext,
  args: {
    ledgerEntryId: string;
    workflowId: string;
    workerId: string;
    fencingToken: bigint;
  },
) {
  await assertFencedWrite(
    ctx,
    args.workflowId,
    args.workerId,
    args.fencingToken,
  );
  incrementMetric("unknown_effects");
  const updated = await ctx.db
    .update(effectLedgerEntries)
    .set({
      localExecutionState: "unknown",
      observedExternalState: "unknown",
      updatedAt: new Date(),
    })
    .where(eq(effectLedgerEntries.id, args.ledgerEntryId))
    .returning();
  return updated[0]!;
}
