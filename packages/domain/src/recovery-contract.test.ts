import { describe, expect, it } from "vitest";
import {
  contractForStep,
  ORDER_FULFILLMENT_CONTRACTS,
} from "./recovery-contract.js";

describe("recovery contracts (REQ-11)", () => {
  it("defines seven fulfillment steps", () => {
    expect(ORDER_FULFILLMENT_CONTRACTS).toHaveLength(7);
  });

  it("classifies email as irreversible without compensation", () => {
    const email = contractForStep("send_confirmation_email");
    expect(email.mutationKind).toBe("irreversible_mutation");
    expect(email.compensationMethod).toBeNull();
  });

  it("payment uses stable idempotency and compensatable refund", () => {
    const pay = contractForStep("capture_payment");
    expect(pay.idempotencyKeyStrategy).toBe("stable_workflow_operation");
    expect(pay.compensationMethod).toBe("payment.refund");
    expect(pay.requiredEvidence).toContain("payment_receipt");
  });
});
