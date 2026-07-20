import { describe, expect, it } from "vitest";
import { asOperationId, asWorkflowId, IdentityError } from "./ids.js";
import {
  assertIdempotencyKeyUnchanged,
  stableIdempotencyKey,
} from "./idempotency.js";

describe("idempotency key stability (REQ-12)", () => {
  it("is deterministic for same workflow+operation", () => {
    const wf = asWorkflowId("wf_abc");
    const op = asOperationId("op_pay");
    expect(stableIdempotencyKey(wf, op)).toBe(stableIdempotencyKey(wf, op));
  });

  it("differs across operations", () => {
    const wf = asWorkflowId("wf_abc");
    expect(stableIdempotencyKey(wf, asOperationId("op_a"))).not.toBe(
      stableIdempotencyKey(wf, asOperationId("op_b")),
    );
  });

  it("refuses key rotation", () => {
    const wf = asWorkflowId("wf_abc");
    const op = asOperationId("op_pay");
    const good = stableIdempotencyKey(wf, op);
    expect(() => assertIdempotencyKeyUnchanged(wf, op, good)).not.toThrow();
    expect(() =>
      assertIdempotencyKeyUnchanged(wf, op, stableIdempotencyKey(wf, asOperationId("other"))),
    ).toThrow(IdentityError);
  });
});
