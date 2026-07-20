# API

## ACP JSON-RPC — `POST /acp/jsonrpc`

Authorization: `Bearer $API_BEARER_TOKEN`

Methods:

- `initialize`
- `session/new` — params: `{ principalId, workflowId? }`
- `session/resume` — params: `{ sessionId }` → never retries effects
- `session/prompt` — params: `{ sessionId, prompt }`
- `session/cancel` / `session/close`

## Ops REST

- `GET /ops/sessions`
- `GET /ops/workflows`
- `GET /ops/workflows/:id` — lease, operations, ledger
- `GET /ops/workflows/:id/evidence`

## Providers (port 8090)

- `POST /payment/capture`, `GET /payment/reconcile`
- `POST /inventory/reserve`, `GET /inventory/reconcile`
- `POST /email/send`, `GET /email/reconcile`
- `POST /crm/update`, `GET /crm/reconcile`
