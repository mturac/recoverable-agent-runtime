export const EFFECT_CLASSIFICATIONS = [
  "not_started",
  "requested",
  "confirmed_success",
  "confirmed_failure",
  "pending",
  "unknown",
  "partially_applied",
] as const;

export type EffectClassification = (typeof EFFECT_CLASSIFICATIONS)[number];

export const RECOVERY_DECISIONS = [
  "execute",
  "continue",
  "retry",
  "wait",
  "reconcile",
  "compensate",
  "manual_review",
] as const;

export type RecoveryDecision = (typeof RECOVERY_DECISIONS)[number];

export const MUTATION_KINDS = [
  "pure",
  "read_only",
  "idempotent_mutation",
  "compensatable_mutation",
  "irreversible_mutation",
] as const;

export type MutationKind = (typeof MUTATION_KINDS)[number];

/**
 * Unknown mutations must never be blindly retried (REQ-14 domain rule).
 * `retry` is only legal when classification is confirmed_failure or not_started
 * (or requested under explicit policy — not for unknown).
 */
export function isBlindRetryForbidden(
  classification: EffectClassification,
  decision: RecoveryDecision,
): boolean {
  if (decision !== "retry" && decision !== "execute") {
    return false;
  }
  return (
    classification === "unknown" ||
    classification === "pending" ||
    classification === "requested" ||
    classification === "partially_applied"
  );
}

export function assertSafeRecoveryDecision(
  classification: EffectClassification,
  decision: RecoveryDecision,
): void {
  if (isBlindRetryForbidden(classification, decision)) {
    throw new Error(
      `fail-closed: cannot ${decision} when effect classification is ${classification}`,
    );
  }
}
