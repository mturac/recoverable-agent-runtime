/**
 * Deterministic failure injection keyed by scenario ID (REQ-20).
 * Boundaries from the Recoverable Agent Runtime spec.
 */

export type FailureBoundary =
  | "before_request_dispatch"
  | "after_request_dispatch"
  | "after_external_commit_before_response"
  | "after_response_before_receipt"
  | "after_receipt_before_workflow_transition"
  | "during_reconciliation"
  | "during_compensation"
  | "after_lease_expiry"
  | "during_concurrent_session_resume"
  | "during_concurrent_worker_recovery";

export interface ScenarioPlan {
  scenarioId: string;
  /** Boundaries that should fire once (then clear). */
  fireOnce: FailureBoundary[];
  /** Optional step filter e.g. capture_payment */
  step?: string;
}

export class FailureInjectionError extends Error {
  constructor(
    readonly boundary: FailureBoundary,
    readonly scenarioId: string,
  ) {
    super(`failure_injection:${scenarioId}:${boundary}`);
    this.name = "FailureInjectionError";
  }
}

const armed = new Map<string, ScenarioPlan>();
const fired = new Map<string, Set<FailureBoundary>>();

export function armScenario(plan: ScenarioPlan): void {
  armed.set(plan.scenarioId, plan);
  fired.set(plan.scenarioId, new Set());
}

export function clearScenario(scenarioId: string): void {
  armed.delete(scenarioId);
  fired.delete(scenarioId);
}

export function clearAllScenarios(): void {
  armed.clear();
  fired.clear();
}

export function isArmed(scenarioId: string | undefined): boolean {
  return !!scenarioId && armed.has(scenarioId);
}

/**
 * Call at each boundary. Throws FailureInjectionError when the scenario
 * schedules a crash at this boundary (and step matches if set).
 */
export function maybeInject(
  scenarioId: string | undefined,
  boundary: FailureBoundary,
  step?: string,
): void {
  if (!scenarioId) return;
  const plan = armed.get(scenarioId);
  if (!plan) return;
  if (plan.step && step && plan.step !== step) return;
  if (!plan.fireOnce.includes(boundary)) return;
  const seen = fired.get(scenarioId) ?? new Set();
  if (seen.has(boundary)) return;
  seen.add(boundary);
  fired.set(scenarioId, seen);
  throw new FailureInjectionError(boundary, scenarioId);
}

/** Canonical payment-crash scenario: crash after provider commit, before local receipt. */
export const PAYMENT_CRASH_SCENARIO = "payment_crash_after_commit";

export function armPaymentCrashScenario(): void {
  armScenario({
    scenarioId: PAYMENT_CRASH_SCENARIO,
    step: "capture_payment",
    fireOnce: ["after_external_commit_before_response"],
  });
}
