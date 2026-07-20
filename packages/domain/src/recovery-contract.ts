import type { MutationKind } from "./effects.js";

export type FulfillmentStepName =
  | "create_order"
  | "reserve_inventory"
  | "capture_payment"
  | "generate_invoice"
  | "send_confirmation_email"
  | "update_crm"
  | "verify_final_outcome";

export interface RetryPolicy {
  maxAttempts: number;
  initialIntervalMs: number;
  backoffCoefficient: number;
  maxIntervalMs: number;
}

export interface RecoveryContract {
  step: FulfillmentStepName;
  /** Stable logical operation name within a workflow. */
  operationName: string;
  mutationKind: MutationKind;
  requiredPolicy: string;
  /** Always "stable(workflowId,operationId)" for mutations. */
  idempotencyKeyStrategy: "stable_workflow_operation" | "none";
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  reconciliationMethod: string;
  compensationMethod: string | null;
  requiredEvidence: readonly string[];
  manualReviewConditions: readonly string[];
}

const defaultRetry: RetryPolicy = {
  maxAttempts: 3,
  initialIntervalMs: 500,
  backoffCoefficient: 2,
  maxIntervalMs: 10_000,
};

export const ORDER_FULFILLMENT_CONTRACTS: readonly RecoveryContract[] = [
  {
    step: "create_order",
    operationName: "order.create",
    mutationKind: "idempotent_mutation",
    requiredPolicy: "order.write",
    idempotencyKeyStrategy: "stable_workflow_operation",
    timeoutMs: 5_000,
    retryPolicy: defaultRetry,
    reconciliationMethod: "order.getByIdempotencyKey",
    compensationMethod: null,
    requiredEvidence: ["order_record"],
    manualReviewConditions: ["order_inconsistent"],
  },
  {
    step: "reserve_inventory",
    operationName: "inventory.reserve",
    mutationKind: "compensatable_mutation",
    requiredPolicy: "inventory.reserve",
    idempotencyKeyStrategy: "stable_workflow_operation",
    timeoutMs: 10_000,
    retryPolicy: defaultRetry,
    reconciliationMethod: "inventory.getReservationByKey",
    compensationMethod: "inventory.release",
    requiredEvidence: ["reservation_receipt"],
    manualReviewConditions: ["partial_reservation"],
  },
  {
    step: "capture_payment",
    operationName: "payment.capture",
    mutationKind: "compensatable_mutation",
    requiredPolicy: "payment.capture",
    idempotencyKeyStrategy: "stable_workflow_operation",
    timeoutMs: 15_000,
    retryPolicy: { ...defaultRetry, maxAttempts: 1 },
    reconciliationMethod: "payment.getByIdempotencyKey",
    compensationMethod: "payment.refund",
    requiredEvidence: ["payment_receipt"],
    manualReviewConditions: ["payment_unknown_after_reconcile"],
  },
  {
    step: "generate_invoice",
    operationName: "invoice.generate",
    mutationKind: "compensatable_mutation",
    requiredPolicy: "invoice.write",
    idempotencyKeyStrategy: "stable_workflow_operation",
    timeoutMs: 10_000,
    retryPolicy: defaultRetry,
    reconciliationMethod: "invoice.getByOrderId",
    compensationMethod: "invoice.cancel",
    requiredEvidence: ["invoice_receipt"],
    manualReviewConditions: ["invoice_mismatch"],
  },
  {
    step: "send_confirmation_email",
    operationName: "email.send_confirmation",
    mutationKind: "irreversible_mutation",
    requiredPolicy: "email.send",
    idempotencyKeyStrategy: "stable_workflow_operation",
    timeoutMs: 10_000,
    retryPolicy: { ...defaultRetry, maxAttempts: 1 },
    reconciliationMethod: "email.getByIdempotencyKey",
    compensationMethod: null,
    requiredEvidence: ["email_receipt"],
    manualReviewConditions: ["email_unknown"],
  },
  {
    step: "update_crm",
    operationName: "crm.update_order",
    mutationKind: "compensatable_mutation",
    requiredPolicy: "crm.write",
    idempotencyKeyStrategy: "stable_workflow_operation",
    timeoutMs: 10_000,
    retryPolicy: defaultRetry,
    reconciliationMethod: "crm.getByOrderId",
    compensationMethod: "crm.reverse_update",
    requiredEvidence: ["crm_receipt"],
    manualReviewConditions: ["crm_divergence"],
  },
  {
    step: "verify_final_outcome",
    operationName: "workflow.verify",
    mutationKind: "read_only",
    requiredPolicy: "workflow.verify",
    idempotencyKeyStrategy: "none",
    timeoutMs: 5_000,
    retryPolicy: defaultRetry,
    reconciliationMethod: "workflow.listUnknownEffects",
    compensationMethod: null,
    requiredEvidence: ["verification_result", "no_unknown_effects"],
    manualReviewConditions: ["unresolved_unknown_effect"],
  },
] as const;

export function contractForStep(step: FulfillmentStepName): RecoveryContract {
  const found = ORDER_FULFILLMENT_CONTRACTS.find((c) => c.step === step);
  if (!found) {
    throw new Error(`no recovery contract for step ${step}`);
  }
  return found;
}
