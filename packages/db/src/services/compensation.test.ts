import { describe, expect, it, beforeEach } from "vitest";
import { seedWorkflowFixture, withTestDb } from "../test/setup.js";
import { acquireLease } from "./leases.js";
import { issueGrant } from "./control-plane.js";
import {
  decideEmailUnknown,
  resumeCompensation,
  runCompensation,
} from "./compensation.js";
import { resetMetrics, getMetric } from "./metrics.js";
import { eq } from "drizzle-orm";
import { compensationRecords } from "../schema/platform.js";

describe("compensation (REQ-22)", () => {
  beforeEach(() => resetMetrics());

  it("runs compensation with own operation id and recovery auth", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const lease = await acquireLease(ctx, fx.workflowId, "worker-1", 60_000);
      const grant = await issueGrant(ctx, {
        principalId: fx.principalId,
        workflowId: fx.workflowId,
        scope: "payment.refund",
        kind: "recovery",
        ttlMs: 60_000,
      });

      const result = await runCompensation(ctx, {
        workflowId: fx.workflowId,
        sourceOperationId: fx.operationId,
        target: "payment.refund",
        principalId: fx.principalId,
        recoveryGrantId: grant.grantId,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
        execute: async () => ({ externalReceiptId: "rcpt_refund_1" }),
      });

      expect(result.compensationOperationId).not.toBe(fx.operationId);
      expect(result.externalReceiptId).toBe("rcpt_refund_1");
      expect(getMetric("compensation_attempts")).toBe(1);

      const rows = await ctx.db
        .select()
        .from(compensationRecords)
        .where(eq(compensationRecords.id, result.compensationRecordId));
      expect(rows[0]?.status).toBe("completed");
    });
  });

  it("marks interrupted and can resume", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const lease = await acquireLease(ctx, fx.workflowId, "worker-1", 60_000);
      const grant1 = await issueGrant(ctx, {
        principalId: fx.principalId,
        workflowId: fx.workflowId,
        scope: "inventory.release",
        kind: "recovery",
        ttlMs: 60_000,
      });

      let calls = 0;
      await expect(
        runCompensation(ctx, {
          workflowId: fx.workflowId,
          sourceOperationId: fx.operationId,
          target: "inventory.release",
          principalId: fx.principalId,
          recoveryGrantId: grant1.grantId,
          workerId: "worker-1",
          fencingToken: lease.fencingToken,
          execute: async () => {
            calls += 1;
            throw new Error("provider down");
          },
        }),
      ).rejects.toThrow(/provider down/);

      const interrupted = await ctx.db.select().from(compensationRecords);
      const rec = interrupted.find((r) => r.status === "interrupted");
      expect(rec).toBeTruthy();

      const grant2 = await issueGrant(ctx, {
        principalId: fx.principalId,
        workflowId: fx.workflowId,
        scope: "compensation.resume",
        kind: "recovery",
        ttlMs: 60_000,
      });

      const resumed = await resumeCompensation(ctx, {
        workflowId: fx.workflowId,
        compensationRecordId: rec!.id,
        compensationOperationId: rec!.compensationOperationId,
        principalId: fx.principalId,
        recoveryGrantId: grant2.grantId,
        workerId: "worker-1",
        fencingToken: lease.fencingToken,
        execute: async () => {
          calls += 1;
          return { externalReceiptId: "rcpt_release" };
        },
      });
      expect(resumed.externalReceiptId).toBe("rcpt_release");
      expect(calls).toBe(2);
    });
  });

  it("email unknown forbids resend", () => {
    const d = decideEmailUnknown();
    expect(d.resendAllowed).toBe(false);
    expect(d.decision === "manual_review" || d.decision === "reconcile").toBe(
      true,
    );
  });
});
