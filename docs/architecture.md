# Architecture — Recoverable Agent Runtime

## Purpose

Separate **ACP session resume** (control/conversation context) from **workflow execution recovery** (durable business effects with receipts and reconciliation).

## Components

| Component | Location | Role |
|-----------|----------|------|
| ACP Session Service | `packages/acp`, `apps/api` | initialize, session/* — no side-effect retry on resume |
| Control plane | `packages/db/services/control-plane` | grants, policy, recovery auth, ownership |
| Durable workflow | Temporal + `apps/worker` engine | order fulfillment steps |
| Execution plane | `apps/worker` | leases, fencing, failure injection |
| Effect ledger | `packages/db/services/ledger` | attempts, hashes, receipts |
| Reconciliation | `packages/db/services/reconciliation` | classify + decide with evidence |
| Evidence | `packages/evidence` | hash-chained HMAC packets |
| Providers | `apps/providers` | authoritative inventory/payment/email/crm |
| Dashboard | `apps/dashboard` | ops view: session ≠ workflow |

## Identity

`sessionId` ≠ `workflowId` ≠ `operationId` ≠ `attemptId` ≠ `idempotencyKey` ≠ `externalReceiptId`

Idempotency keys are stable: `idem:{workflowId}:{operationId}`.
