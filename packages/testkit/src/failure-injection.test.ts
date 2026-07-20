import { describe, expect, it, beforeEach } from "vitest";
import {
  armPaymentCrashScenario,
  armScenario,
  clearAllScenarios,
  FailureInjectionError,
  maybeInject,
  PAYMENT_CRASH_SCENARIO,
} from "./failure-injection.js";

describe("failure injection", () => {
  beforeEach(() => clearAllScenarios());

  it("fires once at configured boundary for payment crash", () => {
    armPaymentCrashScenario();
    expect(() =>
      maybeInject(PAYMENT_CRASH_SCENARIO, "before_request_dispatch", "capture_payment"),
    ).not.toThrow();
    expect(() =>
      maybeInject(
        PAYMENT_CRASH_SCENARIO,
        "after_external_commit_before_response",
        "capture_payment",
      ),
    ).toThrow(FailureInjectionError);
    // second time same boundary does not re-fire
    expect(() =>
      maybeInject(
        PAYMENT_CRASH_SCENARIO,
        "after_external_commit_before_response",
        "capture_payment",
      ),
    ).not.toThrow();
  });

  it("respects step filter", () => {
    armScenario({
      scenarioId: "x",
      step: "capture_payment",
      fireOnce: ["before_request_dispatch"],
    });
    expect(() =>
      maybeInject("x", "before_request_dispatch", "reserve_inventory"),
    ).not.toThrow();
    expect(() =>
      maybeInject("x", "before_request_dispatch", "capture_payment"),
    ).toThrow(FailureInjectionError);
  });
});
