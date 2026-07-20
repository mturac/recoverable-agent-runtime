import { randomUUID } from "node:crypto";
import type { RepoContext } from "../repos/types.js";
import {
  compensationRecords,
  operations,
} from "../schema/platform.js";
import { authorizeRecovery } from "./control-plane.js";
import { incrementMetric } from "./metrics.js";
import { assertFencedWrite } from "./leases.js";

export type CompensationTarget =
  | "inventory.release"
  | "payment.refund"
  | "invoice.cancel"
  | "crm.reverse";

export interface CompensationRequest {
  workflowId: string;
  sourceOperationId: string;
  target: CompensationTarget;
  principalId: string;
  recoveryGrantId: string;
  workerId: string;
  fencingToken: bigint;
  /** Execute the external compensation; must be idempotent. */
  execute: () => Promise<{ externalReceiptId: string; raw?: unknown }>;
  scope?: string;
}

/**
 * Compensation has its own operation ID, separate auth, is fenced and
 * checkpointed (REQ-22). Email has no compensation path here.
 */
export async function runCompensation(
  ctx: RepoContext,
  req: CompensationRequest,
): Promise<{
  compensationOperationId: string;
  compensationRecordId: string;
  externalReceiptId: string;
}> {
  await assertFencedWrite(
    ctx,
    req.workflowId,
    req.workerId,
    req.fencingToken,
  );

  await authorizeRecovery(ctx, {
    principalId: req.principalId,
    workflowId: req.workflowId,
    scope: req.scope ?? req.target,
    grantId: req.recoveryGrantId,
  });

  const compensationOperationId = `op_comp_${randomUUID()}`;
  const idempotencyKey = `idem:${req.workflowId}:${compensationOperationId}`;

  await ctx.db.insert(operations).values({
    id: compensationOperationId,
    workflowId: req.workflowId,
    operationName: req.target,
    recoveryState: "execution_started",
    version: 0,
    idempotencyKey,
    mutationKind: "compensatable_mutation",
  });

  const compensationRecordId = `comp_${randomUUID()}`;
  await ctx.db.insert(compensationRecords).values({
    id: compensationRecordId,
    workflowId: req.workflowId,
    sourceOperationId: req.sourceOperationId,
    compensationOperationId,
    status: "started",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  incrementMetric("compensation_attempts");

  try {
    const result = await req.execute();
    await ctx.db
      .update(compensationRecords)
      .set({ status: "completed", updatedAt: new Date() })
      .where(
        // drizzle eq
        (await import("drizzle-orm")).eq(
          compensationRecords.id,
          compensationRecordId,
        ),
      );
    await ctx.db
      .update(operations)
      .set({
        recoveryState: "verified",
        version: 1,
        updatedAt: new Date(),
      })
      .where(
        (await import("drizzle-orm")).eq(operations.id, compensationOperationId),
      );

    return {
      compensationOperationId,
      compensationRecordId,
      externalReceiptId: result.externalReceiptId,
    };
  } catch (err) {
    await ctx.db
      .update(compensationRecords)
      .set({ status: "interrupted", updatedAt: new Date() })
      .where(
        (await import("drizzle-orm")).eq(
          compensationRecords.id,
          compensationRecordId,
        ),
      );
    await ctx.db
      .update(operations)
      .set({
        recoveryState: "interrupted",
        version: 1,
        updatedAt: new Date(),
      })
      .where(
        (await import("drizzle-orm")).eq(operations.id, compensationOperationId),
      );
    throw err;
  }
}

/**
 * Resume a previously interrupted compensation (same compensation operation).
 */
export async function resumeCompensation(
  ctx: RepoContext,
  args: {
    workflowId: string;
    compensationRecordId: string;
    compensationOperationId: string;
    principalId: string;
    recoveryGrantId: string;
    workerId: string;
    fencingToken: bigint;
    execute: () => Promise<{ externalReceiptId: string }>;
    scope?: string;
  },
): Promise<{ externalReceiptId: string }> {
  await assertFencedWrite(
    ctx,
    args.workflowId,
    args.workerId,
    args.fencingToken,
  );
  await authorizeRecovery(ctx, {
    principalId: args.principalId,
    workflowId: args.workflowId,
    scope: args.scope ?? "compensation.resume",
    grantId: args.recoveryGrantId,
  });

  incrementMetric("compensation_attempts");
  const result = await args.execute();
  const { eq } = await import("drizzle-orm");
  await ctx.db
    .update(compensationRecords)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(compensationRecords.id, args.compensationRecordId));
  await ctx.db
    .update(operations)
    .set({ recoveryState: "verified", updatedAt: new Date() })
    .where(eq(operations.id, args.compensationOperationId));
  return result;
}

/** Email is irreversible — unknown email must not trigger resend. */
export function decideEmailUnknown(): RecoveryDecisionSafe {
  return { decision: "manual_review", resendAllowed: false };
}

export interface RecoveryDecisionSafe {
  decision: "reconcile" | "manual_review";
  resendAllowed: false;
}
