import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  armPaymentCrashScenario,
  clearAllScenarios,
  PAYMENT_CRASH_SCENARIO,
} from "@rar/testkit";
import { recoverPaymentCrash, runFulfillment } from "./engine.js";

describe("fulfillment + payment crash recovery (REQ-17, REQ-20, REQ-21 core)", () => {
  beforeEach(() => clearAllScenarios());

  it("happy path completes steps", async () => {
    const orderId = `ord_${randomUUID()}`;
    const result = await runFulfillment({
      principalId: "principal_demo_human",
      orderId,
      amountCents: 1000,
      currency: "USD",
      sku: "SKU-1",
      quantity: 1,
      emailTo: "buyer@example.com",
    });
    expect(result.completed).toBe(true);
    expect(result.steps).toContain("capture_payment");
    expect(result.paymentId).toBeTruthy();
  }, 60_000);

  it("payment crash leaves unknown effect; recovery finds single payment", async () => {
    armPaymentCrashScenario();
    const orderId = `ord_${randomUUID()}`;
    const principalId = "principal_demo_human";
    const result = await runFulfillment({
      principalId,
      orderId,
      amountCents: 4200,
      currency: "USD",
      sku: "SKU-1",
      quantity: 1,
      emailTo: "buyer@example.com",
      scenarioId: PAYMENT_CRASH_SCENARIO,
      workerId: "worker_crash",
    });

    expect(result.completed).toBe(false);
    expect(result.crashed?.step).toBe("capture_payment");
    expect(result.crashed?.boundary).toBe(
      "after_external_commit_before_response",
    );
    expect(result.crashed?.idempotencyKey).toBeTruthy();

    const recovered = await recoverPaymentCrash({
      workflowId: result.workflowId,
      operationId: result.crashed!.operationId,
      idempotencyKey: result.crashed!.idempotencyKey,
      principalId,
      workerId: "worker_recovery",
    });

    expect(recovered.paymentCount).toBe(1);
    expect(recovered.classification).toBe("confirmed_success");
    expect(recovered.decision).toBe("continue");
    expect(recovered.receiptId).toBeTruthy();
  }, 60_000);
});
