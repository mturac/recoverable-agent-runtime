import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { seedWorkflowFixture, withTestDb } from "../test/setup.js";
import { acquireLease } from "./leases.js";
import {
  markConfirmedSuccess,
  markUnknown,
  persistExternalReceipt,
  recordAttempt,
} from "./ledger.js";
import { updateOperationStateFenced } from "./operations.js";
import { ReceiptRequiredError, StaleWorkerError, OccConflictError } from "./errors.js";
import { resetMetrics, getMetric } from "./metrics.js";
import { updateWorkflowState } from "../repos/workflows.js";

describe("effect ledger and receipts (REQ-13, REQ-16)", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("records attempt with required identity fields", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const lease = await acquireLease(ctx, fx.workflowId, "worker-1", 60_000);
      const attemptId = `att_${randomUUID()}`;

      const entry = await recordAttempt(ctx, {
        workflowId: fx.workflowId,
        operationId: fx.operationId,
        attemptId,
        attemptNumber: 1,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
        idempotencyKey: fx.idempotencyKey,
        requestPayload: { amount: 100, currency: "USD" },
      });

      expect(entry.workflowId).toBe(fx.workflowId);
      expect(entry.operationId).toBe(fx.operationId);
      expect(entry.attemptId).toBe(attemptId);
      expect(entry.idempotencyKey).toBe(fx.idempotencyKey);
      expect(entry.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.localExecutionState).toBe("dispatched");
      expect(entry.correlation.fencingToken).toBe(
        lease.fencingToken.toString(),
      );
    });
  });

  it("fails closed when confirming without receipt", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const lease = await acquireLease(ctx, fx.workflowId, "worker-1", 60_000);
      const attemptId = `att_${randomUUID()}`;
      const entry = await recordAttempt(ctx, {
        workflowId: fx.workflowId,
        operationId: fx.operationId,
        attemptId,
        attemptNumber: 1,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
        idempotencyKey: fx.idempotencyKey,
        requestPayload: { amount: 50 },
      });

      await expect(
        markConfirmedSuccess(ctx, {
          ledgerEntryId: entry.id,
          workflowId: fx.workflowId,
          workerId: "worker-1",
          fencingToken: lease.fencingToken,
          externalReceiptId: "missing_receipt",
          responsePayload: { ok: true },
        }),
      ).rejects.toBeInstanceOf(ReceiptRequiredError);

      expect(getMetric("confirmed_without_receipt_rejected")).toBe(1);
    });
  });

  it("confirms success only after receipt is persisted", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const lease = await acquireLease(ctx, fx.workflowId, "worker-1", 60_000);
      const attemptId = `att_${randomUUID()}`;
      const entry = await recordAttempt(ctx, {
        workflowId: fx.workflowId,
        operationId: fx.operationId,
        attemptId,
        attemptNumber: 1,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
        idempotencyKey: fx.idempotencyKey,
        requestPayload: { amount: 50 },
      });

      const receiptId = `rcpt_${randomUUID()}`;
      await persistExternalReceipt(ctx, {
        receiptId,
        provider: "payment",
        externalId: "pay_123",
        idempotencyKey: fx.idempotencyKey,
        payload: { paymentId: "pay_123", status: "captured" },
      });

      const confirmed = await markConfirmedSuccess(ctx, {
        ledgerEntryId: entry.id,
        workflowId: fx.workflowId,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
        externalReceiptId: receiptId,
        responsePayload: { paymentId: "pay_123", status: "captured" },
      });

      expect(confirmed.localExecutionState).toBe("confirmed_success");
      expect(confirmed.externalReceiptId).toBe(receiptId);
      expect(confirmed.responseHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  it("marks unknown under fence and increments metric", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const lease = await acquireLease(ctx, fx.workflowId, "worker-1", 60_000);
      const entry = await recordAttempt(ctx, {
        workflowId: fx.workflowId,
        operationId: fx.operationId,
        attemptId: `att_${randomUUID()}`,
        attemptNumber: 1,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
        idempotencyKey: fx.idempotencyKey,
        requestPayload: { amount: 50 },
      });

      const unknown = await markUnknown(ctx, {
        ledgerEntryId: entry.id,
        workflowId: fx.workflowId,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
      });
      expect(unknown.localExecutionState).toBe("unknown");
      expect(getMetric("unknown_effects")).toBe(1);
    });
  });

  it("rejects ledger write with stale fencing token", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const l1 = await acquireLease(ctx, fx.workflowId, "worker-1", 60_000);
      await releaseLeaseCompat(ctx, fx.workflowId, "worker-1", l1.fencingToken);
      await acquireLease(ctx, fx.workflowId, "worker-2", 60_000);

      await expect(
        recordAttempt(ctx, {
          workflowId: fx.workflowId,
          operationId: fx.operationId,
          attemptId: `att_${randomUUID()}`,
          attemptNumber: 1,
          workerId: "worker-1",
          fencingToken: l1.fencingToken,
          idempotencyKey: fx.idempotencyKey,
          requestPayload: {},
        }),
      ).rejects.toBeInstanceOf(StaleWorkerError);
    });
  });
});

describe("OCC workflow and operation updates (REQ-09)", () => {
  it("rejects mismatched workflow version", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const ok = await updateWorkflowState(
        ctx,
        fx.workflowId,
        "effect_unknown",
        0,
      );
      expect(ok.ok).toBe(true);
      const bad = await updateWorkflowState(
        ctx,
        fx.workflowId,
        "reconciliation_required",
        0,
      );
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.reason).toBe("version_mismatch");
    });
  });

  it("rejects mismatched operation version under fence", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const lease = await acquireLease(ctx, fx.workflowId, "worker-1", 60_000);
      await updateOperationStateFenced(ctx, {
        operationId: fx.operationId,
        workflowId: fx.workflowId,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
        recoveryState: "effect_unknown",
        expectedVersion: 0,
      });
      await expect(
        updateOperationStateFenced(ctx, {
          operationId: fx.operationId,
          workflowId: fx.workflowId,
          workerId: "worker-1",
          fencingToken: lease.fencingToken,
          recoveryState: "reconciliation_required",
          expectedVersion: 0,
        }),
      ).rejects.toBeInstanceOf(OccConflictError);
    });
  });
});

async function releaseLeaseCompat(
  ctx: Parameters<typeof acquireLease>[0],
  workflowId: string,
  workerId: string,
  token: bigint,
) {
  const { releaseLease } = await import("./leases.js");
  await releaseLease(ctx, workflowId, workerId, token);
}
