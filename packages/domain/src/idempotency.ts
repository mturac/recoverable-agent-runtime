import {
  asIdempotencyKey,
  type IdempotencyKey,
  type OperationId,
  type WorkflowId,
  IdentityError,
} from "./ids.js";

/**
 * Stable idempotency key strategy (REQ-12).
 * Key is a pure function of (workflowId, operationId). Rotation refused.
 */
export function stableIdempotencyKey(
  workflowId: WorkflowId,
  operationId: OperationId,
): IdempotencyKey {
  return asIdempotencyKey(`idem:${workflowId}:${operationId}`);
}

export function assertIdempotencyKeyUnchanged(
  workflowId: WorkflowId,
  operationId: OperationId,
  candidate: IdempotencyKey,
): void {
  const expected = stableIdempotencyKey(workflowId, operationId);
  if ((candidate as string) !== (expected as string)) {
    throw new IdentityError(
      `idempotency key rotation refused: expected ${expected}, got ${candidate}`,
    );
  }
}
