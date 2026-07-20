/** Recovery state machine (REQ-10) with OCC versioning (REQ-09). */

export const RECOVERY_STATES = [
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
] as const;

export type RecoveryState = (typeof RECOVERY_STATES)[number];

export function isRecoveryState(value: string): value is RecoveryState {
  return (RECOVERY_STATES as readonly string[]).includes(value);
}

/** Legal directed edges. Terminal-ish states still allow limited recovery exits. */
export const LEGAL_TRANSITIONS: Readonly<
  Record<RecoveryState, readonly RecoveryState[]>
> = {
  planned: ["authorization_pending", "rejected"],
  authorization_pending: ["authorized", "rejected", "manual_review"],
  authorized: ["execution_started", "rejected", "interrupted"],
  execution_started: [
    "effect_requested",
    "interrupted",
    "rejected",
    "effect_unknown",
  ],
  effect_requested: [
    "effect_observed",
    "effect_unknown",
    "interrupted",
    "partially_applied",
    "reconciliation_required",
  ],
  effect_unknown: [
    "reconciliation_required",
    "manual_review",
    "effect_observed",
    "interrupted",
  ],
  effect_observed: [
    "verification_pending",
    "compensation_required",
    "partially_applied",
    "manual_review",
  ],
  verification_pending: ["verified", "rejected", "manual_review", "reconciliation_required"],
  verified: [],
  rejected: ["manual_review"],
  interrupted: [
    "reconciliation_required",
    "effect_unknown",
    "manual_review",
    "authorization_pending",
  ],
  partially_applied: [
    "reconciliation_required",
    "compensation_required",
    "manual_review",
  ],
  reconciliation_required: [
    "effect_observed",
    "effect_unknown",
    "manual_review",
    "compensation_required",
    "verification_pending",
    "execution_started",
  ],
  compensation_required: ["compensating", "manual_review"],
  compensating: [
    "compensated",
    "interrupted",
    "partially_applied",
    "manual_review",
  ],
  compensated: ["verification_pending", "verified"],
  manual_review: [
    "reconciliation_required",
    "compensation_required",
    "authorized",
    "rejected",
    "verification_pending",
  ],
};

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export interface VersionedState {
  state: RecoveryState;
  version: number;
}

export function canTransition(from: RecoveryState, to: RecoveryState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Apply a recovery state transition with optimistic concurrency.
 * `expectedVersion` must match `current.version`; on success version becomes +1.
 */
export function applyTransition(
  current: VersionedState,
  to: RecoveryState,
  expectedVersion: number,
): VersionedState {
  if (current.version !== expectedVersion) {
    throw new ConcurrencyError(
      `version mismatch: expected ${expectedVersion}, actual ${current.version}`,
    );
  }
  if (!canTransition(current.state, to)) {
    throw new TransitionError(
      `illegal transition ${current.state} -> ${to}`,
    );
  }
  return { state: to, version: current.version + 1 };
}
