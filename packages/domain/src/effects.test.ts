import { describe, expect, it } from "vitest";
import {
  assertSafeRecoveryDecision,
  isBlindRetryForbidden,
} from "./effects.js";

describe("unknown mutation fail-closed domain rules", () => {
  it("forbids retry/execute on unknown", () => {
    expect(isBlindRetryForbidden("unknown", "retry")).toBe(true);
    expect(isBlindRetryForbidden("unknown", "execute")).toBe(true);
    expect(isBlindRetryForbidden("unknown", "reconcile")).toBe(false);
    expect(isBlindRetryForbidden("confirmed_failure", "retry")).toBe(false);
  });

  it("throws on unsafe decision", () => {
    expect(() => assertSafeRecoveryDecision("unknown", "retry")).toThrow(
      /fail-closed/,
    );
  });
});
