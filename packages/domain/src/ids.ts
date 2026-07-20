/** Branded identity types — never interchangeable (REQ-03). */

export type SessionId = string & { readonly __brand: "SessionId" };
export type WorkflowId = string & { readonly __brand: "WorkflowId" };
export type OperationId = string & { readonly __brand: "OperationId" };
export type AttemptId = string & { readonly __brand: "AttemptId" };
export type IdempotencyKey = string & { readonly __brand: "IdempotencyKey" };
export type ExternalReceiptId = string & { readonly __brand: "ExternalReceiptId" };
export type PrincipalId = string & { readonly __brand: "PrincipalId" };
export type WorkerId = string & { readonly __brand: "WorkerId" };
export type GrantId = string & { readonly __brand: "GrantId" };
export type PolicyDecisionId = string & { readonly __brand: "PolicyDecisionId" };

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

function nonEmpty(kind: string, value: string): string {
  const v = value.trim();
  if (v.length === 0) {
    throw new IdentityError(`${kind} must be non-empty`);
  }
  return v;
}

export function asSessionId(value: string): SessionId {
  return nonEmpty("sessionId", value) as SessionId;
}

export function asWorkflowId(value: string): WorkflowId {
  return nonEmpty("workflowId", value) as WorkflowId;
}

export function asOperationId(value: string): OperationId {
  return nonEmpty("operationId", value) as OperationId;
}

export function asAttemptId(value: string): AttemptId {
  return nonEmpty("attemptId", value) as AttemptId;
}

export function asIdempotencyKey(value: string): IdempotencyKey {
  return nonEmpty("idempotencyKey", value) as IdempotencyKey;
}

export function asExternalReceiptId(value: string): ExternalReceiptId {
  return nonEmpty("externalReceiptId", value) as ExternalReceiptId;
}

export function asPrincipalId(value: string): PrincipalId {
  return nonEmpty("principalId", value) as PrincipalId;
}

export function asWorkerId(value: string): WorkerId {
  return nonEmpty("workerId", value) as WorkerId;
}

export function asGrantId(value: string): GrantId {
  return nonEmpty("grantId", value) as GrantId;
}

export function asPolicyDecisionId(value: string): PolicyDecisionId {
  return nonEmpty("policyDecisionId", value) as PolicyDecisionId;
}

/**
 * Reject using a sessionId string as a workflowId when they are known equal
 * in the same context (REQ-03).
 */
export function assertDistinctSessionAndWorkflow(
  sessionId: SessionId,
  workflowId: WorkflowId,
): void {
  if ((sessionId as string) === (workflowId as string)) {
    throw new IdentityError(
      "sessionId must not equal workflowId — identities are separate",
    );
  }
}
