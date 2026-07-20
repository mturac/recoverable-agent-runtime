import { describe, expect, it, beforeEach } from "vitest";
import { seedWorkflowFixture, withTestDb } from "../test/setup.js";
import {
  classifyAndDecide,
  persistReconciliation,
  reconcilePaymentEffect,
} from "./reconciliation.js";
import { resetMetrics, getMetric } from "./metrics.js";
import { assertSafeRecoveryDecision } from "@rar/domain";

describe("reconciliation engine (REQ-14, REQ-15)", () => {
  beforeEach(() => resetMetrics());

  it("discovers confirmed payment and decides continue", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const outcome = await reconcilePaymentEffect(ctx, {
        workflowId: fx.workflowId,
        operationId: fx.operationId,
        localState: "unknown",
        observe: async () => ({
          found: true,
          status: "captured",
          externalId: "pay_abc",
        }),
      });
      expect(outcome.classification).toBe("confirmed_success");
      expect(outcome.decision).toBe("continue");
      expect(outcome.evidenceRef).toBeTruthy();
      expect(getMetric("reconciliation_outcomes")).toBe(1);
    });
  });

  it("never blindly retries unknown", () => {
    const { classification, decision } = classifyAndDecide({
      workflowId: "wf",
      operationId: "op",
      localState: "unknown",
      observation: { found: false },
    });
    expect(classification).toBe("unknown");
    expect(decision).toBe("manual_review");
    expect(() =>
      assertSafeRecoveryDecision("unknown", "retry"),
    ).toThrow(/fail-closed/);
    expect(() =>
      assertSafeRecoveryDecision("unknown", "execute"),
    ).toThrow(/fail-closed/);
  });

  it("pending external yields wait", () => {
    const r = classifyAndDecide({
      workflowId: "wf",
      operationId: "op",
      localState: "requested",
      observation: { found: true, status: "pending" },
    });
    expect(r.decision).toBe("wait");
    expect(r.classification).toBe("pending");
  });

  it("persists evidence reference on every decision", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const outcome = await persistReconciliation(ctx, {
        workflowId: fx.workflowId,
        operationId: fx.operationId,
        localState: "unknown",
        observation: { found: true, status: "weird" },
        evidenceSeed: "ev_custom",
      });
      expect(outcome.evidenceRef).toBe("ev_custom");
      expect(outcome.decision).toBe("manual_review");
    });
  });
});
