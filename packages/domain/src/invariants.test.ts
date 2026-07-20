import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  assertSafeRecoveryDecision,
  applyTransition,
  canTransition,
  LEGAL_TRANSITIONS,
  RECOVERY_STATES,
  type RecoveryState,
  stableIdempotencyKey,
  asWorkflowId,
  asOperationId,
  assertDistinctSessionAndWorkflow,
  asSessionId,
  IdentityError,
} from "./index.js";

describe("mandatory invariants (REQ-25)", () => {
  it("unknown mutation never blindly retried", () => {
    for (const d of ["retry", "execute"] as const) {
      expect(() => assertSafeRecoveryDecision("unknown", d)).toThrow();
    }
    expect(() =>
      assertSafeRecoveryDecision("unknown", "reconcile"),
    ).not.toThrow();
  });

  it("sessionId is never workflowId", () => {
    expect(() =>
      assertDistinctSessionAndWorkflow(asSessionId("x"), asWorkflowId("x")),
    ).toThrow(IdentityError);
  });

  it("idempotency key stable across retries", () => {
    const wf = asWorkflowId("wf_1");
    const op = asOperationId("op_pay");
    const a = stableIdempotencyKey(wf, op);
    const b = stableIdempotencyKey(wf, op);
    expect(a).toBe(b);
  });

  it("verified has no path from unknown without recon edge", () => {
    expect(canTransition("effect_unknown", "verified")).toBe(false);
    expect(canTransition("effect_unknown", "reconciliation_required")).toBe(
      true,
    );
  });

  it("property: illegal transitions never apply", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RECOVERY_STATES),
        fc.constantFrom(...RECOVERY_STATES),
        (from, to) => {
          if (canTransition(from as RecoveryState, to as RecoveryState)) return;
          expect(() =>
            applyTransition(
              { state: from as RecoveryState, version: 0 },
              to as RecoveryState,
              0,
            ),
          ).toThrow();
        },
      ),
    );
  });

  it("property: legal transitions bump version by 1", () => {
    for (const from of RECOVERY_STATES) {
      for (const to of LEGAL_TRANSITIONS[from]) {
        const next = applyTransition({ state: from, version: 3 }, to, 3);
        expect(next.version).toBe(4);
        expect(next.state).toBe(to);
      }
    }
  });
});
