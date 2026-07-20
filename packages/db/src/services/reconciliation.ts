import { randomUUID } from "node:crypto";
import {
  assertSafeRecoveryDecision,
  type EffectClassification,
  type RecoveryDecision,
} from "@rar/domain";
import type { RepoContext } from "../repos/types.js";
import { reconciliationResults } from "../schema/platform.js";
import { incrementMetric } from "./metrics.js";

export interface ExternalObservation {
  found: boolean;
  status?: string;
  externalId?: string;
  raw?: unknown;
}

export interface ReconciliationInput {
  workflowId: string;
  operationId: string;
  /** Local ledger view before recon */
  localState: "not_started" | "requested" | "unknown" | "confirmed_success" | "confirmed_failure";
  observation: ExternalObservation;
  evidenceSeed?: string;
}

export interface ReconciliationOutcome {
  id: string;
  classification: EffectClassification;
  decision: RecoveryDecision;
  evidenceRef: string;
}

/**
 * Classify external observation and produce a recovery decision (REQ-15).
 * Never returns execute/retry for unknown/pending/requested when blind retry forbidden (REQ-14).
 */
export function classifyAndDecide(input: ReconciliationInput): {
  classification: EffectClassification;
  decision: RecoveryDecision;
} {
  if (!input.observation.found) {
    if (input.localState === "not_started") {
      return { classification: "not_started", decision: "execute" };
    }
    if (input.localState === "requested" || input.localState === "unknown") {
      // External not found but we may have requested — still uncertain if lossy
      return { classification: "unknown", decision: "manual_review" };
    }
    return { classification: "not_started", decision: "execute" };
  }

  const status = (input.observation.status ?? "").toLowerCase();
  if (status === "pending" || status === "processing") {
    return { classification: "pending", decision: "wait" };
  }
  if (
    status === "captured" ||
    status === "reserved" ||
    status === "sent" ||
    status === "fulfilled" ||
    status === "succeeded" ||
    status === "success"
  ) {
    return { classification: "confirmed_success", decision: "continue" };
  }
  if (
    status === "failed" ||
    status === "rejected" ||
    status === "declined"
  ) {
    return { classification: "confirmed_failure", decision: "retry" };
  }
  if (status === "partial") {
    return { classification: "partially_applied", decision: "manual_review" };
  }
  if (status === "refunded" || status === "released" || status === "reversed") {
    return { classification: "confirmed_success", decision: "continue" };
  }

  return { classification: "unknown", decision: "manual_review" };
}

export async function persistReconciliation(
  ctx: RepoContext,
  input: ReconciliationInput,
): Promise<ReconciliationOutcome> {
  const { classification, decision } = classifyAndDecide(input);

  // Fail closed: never allow blind retry/execute on unsafe classes
  try {
    assertSafeRecoveryDecision(classification, decision);
  } catch {
    // Force manual_review / reconcile path
    const safeDecision: RecoveryDecision =
      classification === "unknown" || classification === "pending"
        ? classification === "pending"
          ? "wait"
          : "manual_review"
        : "reconcile";
    const id = `recon_${randomUUID()}`;
    const evidenceRef = input.evidenceSeed ?? `ev_${id}`;
    await ctx.db.insert(reconciliationResults).values({
      id,
      workflowId: input.workflowId,
      operationId: input.operationId,
      classification,
      decision: safeDecision,
      evidenceRef,
      details: {
        observation: input.observation as unknown as Record<string, unknown>,
        localState: input.localState,
        overridden: true,
      },
      createdAt: new Date(),
    });
    incrementMetric("reconciliation_outcomes");
    if (classification === "unknown") incrementMetric("unknown_effects");
    return { id, classification, decision: safeDecision, evidenceRef };
  }

  const id = `recon_${randomUUID()}`;
  const evidenceRef = input.evidenceSeed ?? `ev_${id}`;
  await ctx.db.insert(reconciliationResults).values({
    id,
    workflowId: input.workflowId,
    operationId: input.operationId,
    classification,
    decision,
    evidenceRef,
    details: {
      observation: input.observation as unknown as Record<string, unknown>,
      localState: input.localState,
    },
    createdAt: new Date(),
  });
  incrementMetric("reconciliation_outcomes");
  if (classification === "unknown") incrementMetric("unknown_effects");
  if (decision === "manual_review") incrementMetric("manual_review_transitions");

  return { id, classification, decision, evidenceRef };
}

/**
 * Payment-specific reconcile: discover by idempotency key via observer fn.
 */
export async function reconcilePaymentEffect(
  ctx: RepoContext,
  args: {
    workflowId: string;
    operationId: string;
    localState: ReconciliationInput["localState"];
    observe: () => Promise<ExternalObservation>;
  },
): Promise<ReconciliationOutcome> {
  const observation = await args.observe();
  return persistReconciliation(ctx, {
    workflowId: args.workflowId,
    operationId: args.operationId,
    localState: args.localState,
    observation,
  });
}
