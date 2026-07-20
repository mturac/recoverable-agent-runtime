import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  applyTransition,
  canTransition,
  ConcurrencyError,
  LEGAL_TRANSITIONS,
  RECOVERY_STATES,
  TransitionError,
  type RecoveryState,
} from "./recovery-states.js";

describe("recovery transitions (REQ-10)", () => {
  it("includes all required states", () => {
    const required = [
      "planned",
      "authorization_pending",
      "authorized",
      "execution_started",
      "effect_requested",
      "effect_unknown",
      "effect_observed",
      "verification_pending",
      "verified",
      "rejected",
      "interrupted",
      "partially_applied",
      "reconciliation_required",
      "compensation_required",
      "compensating",
      "compensated",
      "manual_review",
    ];
    for (const s of required) {
      expect(RECOVERY_STATES).toContain(s);
    }
  });

  it("allows known happy-path edges", () => {
    expect(canTransition("planned", "authorization_pending")).toBe(true);
    expect(canTransition("authorized", "execution_started")).toBe(true);
    expect(canTransition("effect_requested", "effect_unknown")).toBe(true);
    expect(canTransition("effect_unknown", "reconciliation_required")).toBe(
      true,
    );
  });

  it("rejects illegal transitions", () => {
    expect(() =>
      applyTransition({ state: "planned", version: 0 }, "verified", 0),
    ).toThrow(TransitionError);
  });

  it("enforces OCC version match", () => {
    expect(() =>
      applyTransition(
        { state: "planned", version: 2 },
        "authorization_pending",
        1,
      ),
    ).toThrow(ConcurrencyError);
  });

  it("increments version on success", () => {
    const next = applyTransition(
      { state: "planned", version: 0 },
      "authorization_pending",
      0,
    );
    expect(next).toEqual({ state: "authorization_pending", version: 1 });
  });
});

describe("transition invariants (property)", () => {
  it("legal transitions always succeed with matching version", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RECOVERY_STATES),
        fc.integer({ min: 0, max: 1000 }),
        (from, version) => {
          const targets = LEGAL_TRANSITIONS[from as RecoveryState];
          for (const to of targets) {
            const next = applyTransition(
              { state: from as RecoveryState, version },
              to,
              version,
            );
            expect(next.state).toBe(to);
            expect(next.version).toBe(version + 1);
          }
        },
      ),
    );
  });

  it("illegal pairs never transition", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RECOVERY_STATES),
        fc.constantFrom(...RECOVERY_STATES),
        (from, to) => {
          if (canTransition(from as RecoveryState, to as RecoveryState)) {
            return;
          }
          expect(() =>
            applyTransition(
              { state: from as RecoveryState, version: 0 },
              to as RecoveryState,
              0,
            ),
          ).toThrow(TransitionError);
        },
      ),
    );
  });
});
