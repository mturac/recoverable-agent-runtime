# Recoverable Agent Runtime

### Why session resume is not execution recovery

Most agent demos treat “reconnect the chat” as if it were “finish the business process.” Those are different machines.

- A **session** is control state: who is talking, what was said, which tools the agent *might* be allowed to call.
- A **workflow** is durable work with **side effects**: money moved, inventory reserved, email sent, CRM updated.

When a worker dies *after* an external system has committed a mutation but *before* your platform has recorded the receipt, the honest local answer is not “retry.” It is **unknown**. Retrying an unknown mutation is how you double-charge a customer.

**Recoverable Agent Runtime** is a production-shaped reference implementation that makes this distinction executable. It is not a chatbot. It is a small durable execution and recovery platform with a thin [ACP](https://agentclientprotocol.com/)-compatible session layer on top—built so you can *run* the failure, not only diagram it.

---

## The story in one scenario

**Scenario id:** `payment_crash_after_commit`  
**Command:** `npm run demo:payment-crash`

| Step | What happens |
|------|----------------|
| 1–2 | Create order, reserve inventory |
| 3–4 | Capture payment with a **stable idempotency key**; the payment provider **commits** |
| 5 | The worker crashes **before** the response is persisted as a local effect receipt |
| 6–7 | An operator (or agent host) calls ACP **`session/resume`** |
| 8 | The workflow effect is **`unknown`**—not success, not failure |
| 9–11 | A recovery worker takes a **fenced lease**, reconciles the provider with the **same** idempotency key, and finds the existing payment |
| 12–13 | The missing **receipt** is written; the workflow continues **without** a second capture |
| 14 | Exactly **one** payment exists |
| 15 | An **Evidence Packet** is exported (hash chain + HMAC) |

What resume deliberately does **not** do:

- re-dispatch `payment.capture`
- consume an execution grant
- invent success or failure for an unknown effect

What recovery deliberately **does**:

- classify the effect as unknown until the external system is observed
- keep the original idempotency key (never rotate on “retry”)
- require recovery authorization and a fencing token
- attach evidence before continuing

If resume auto-retried the payment whenever a response was lost, a second charge would appear whenever the first commit had already succeeded. That is the bug this runtime exists to prevent.

---

## Architecture (boundaries that matter)

```text
┌─────────────────────┐     ┌──────────────────────────────┐
│  ACP Session Service│     │  Agent Control Plane         │
│  session ≠ workflow │     │  grants · policy · ownership │
└─────────┬───────────┘     └──────────────┬───────────────┘
          │ never auto-retries effects     │
          ▼                                ▼
┌──────────────────────────────────────────────────────────┐
│  Durable fulfillment engine (+ Temporal worker wiring)   │
│  leases · fencing tokens · OCC state transitions         │
└─────────┬───────────────────────────────┬────────────────┘
          │                               │
          ▼                               ▼
┌─────────────────────┐     ┌──────────────────────────────┐
│  Effect Ledger      │     │  Reconciliation Engine       │
│  attempts · hashes  │     │  classify → decide + evidence│
│  receipts           │     │  compensate when authorized  │
└─────────┬───────────┘     └──────────────┬───────────────┘
          │                               │
          └───────────────┬───────────────┘
                          ▼
          ┌───────────────────────────────┐
          │ Mock providers (authoritative)│
          │ inventory · payment · email   │
          │ crm  + read-only reconcile    │
          └───────────────────────────────┘
```

**Identity model** (kept separate and correlated):

`sessionId` · `workflowId` · `operationId` · `attemptId` · `idempotencyKey` · `externalReceiptId`

Rules enforced in code and tests:

- never use `sessionId` as `workflowId`
- never mint a new idempotency key for a retry of the same logical operation
- confirmed success requires an external receipt (fail closed)
- stale workers with lower fencing tokens cannot mutate workflow state

Domain walkthrough: **order fulfillment**

1. Create order  
2. Reserve inventory  
3. Capture payment  
4. Generate invoice  
5. Send confirmation email (*irreversible*)  
6. Update CRM  
7. Verify final outcome  

Email is never “compensated” by blind resend. Unknown email routes to reconcile or manual review.

---

## Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict) |
| Runtime | Node.js ≥ 22 |
| API | Fastify (ACP JSON-RPC + ops REST) |
| Orchestration | Temporal TS SDK (worker wiring) + in-process engine for demos/tests |
| Data | PostgreSQL + Drizzle + SQL migrations |
| Dashboard | Vite + React (ops UI; session plane ≠ workflow plane) |
| Observability | OpenTelemetry API hooks + structured correlation fields |
| Tests | Vitest (unit, property, integration against Postgres) |
| Local infra | Docker Compose (Postgres, Temporal, Temporal UI) |

---

## Quick start

**Prerequisites:** Node.js ≥ 22, npm 10+, Docker (or a local Postgres with user/db `rar` / password `rar`).

```bash
git clone https://github.com/mturac/recoverable-agent-runtime.git
cd recoverable-agent-runtime
cp .env.example .env

docker compose up -d postgres
# if port 5432 is already taken, point DATABASE_URL at your own Postgres:
# export DATABASE_URL=postgres://rar:rar@localhost:5432/rar

npm ci
npm run migrate
npm run seed
npm run build
```

### Full ship gate

```bash
export DATABASE_URL=postgres://rar:rar@localhost:5432/rar
npm run verify:ship
```

This runs typecheck, build, migrate, seed, the test suite, and the mandatory payment-crash demo.

### Just the proof

```bash
npm run demo:payment-crash
```

You should see `payment count = 1` and an evidence file at:

`docs/examples/evidence-payment-crash.json`

### Optional services

```bash
npm run dev -w @rar/api          # ACP + ops API :8080
npm run dev -w @rar/providers    # mock providers :8090
npm run dev -w @rar/dashboard    # ops UI :3000
TEMPORAL_DISABLED=1 npm run dev -w @rar/worker
```

Auth for ops/API defaults is in `.env.example` (`API_BEARER_TOKEN`). Change secrets before any non-local use.

---

## Repository layout

```text
apps/
  api/          ACP JSON-RPC + ops REST
  worker/       Fulfillment engine + Temporal worker
  providers/    Inventory / payment / email / CRM mocks
  dashboard/    Operational UI
packages/
  domain/       Recovery state machine, contracts, identities
  db/           Schema, migrations, ledger, leases, grants, recon
  acp/          Session service
  evidence/     Hash-chained, HMAC-signed packets
  o11y/         Correlation + metric hooks
  testkit/      Deterministic failure injection
docs/           Architecture, state machine, threat model, runbook, API
scripts/        demo:payment-crash, verify-ship
```

More detail: [docs/architecture.md](docs/architecture.md) · [docs/recovery-runbook.md](docs/recovery-runbook.md) · [docs/threat-model.md](docs/threat-model.md)

---

## Design principles (short)

1. **Session is not a workflow.** Resume restores control context only.  
2. **Unknown is a first-class state.** Fail closed; do not guess.  
3. **Idempotency keys are stable.** Retries re-use identity; they do not invent a new one.  
4. **Receipts prove confirmation.** No receipt → not confirmed.  
5. **Leases fence writers.** Stale workers lose.  
6. **Recovery is authorized separately.** Execution grants are not recovery grants.  
7. **Evidence is exportable.** Recovery should be explainable after the fact.

---

## What this is not

- Not a shopping chatbot or multi-tenant SaaS  
- Not a real payment processor (providers are local, authoritative mocks)  
- Not a claim that Temporal alone solves idempotent external IO—you still need a ledger, reconciliation, and fail-closed policy  

It *is* a reference you can clone, run, and break on purpose.

---

## License

MIT — use it, fork it, argue with it, improve it.

---

*If agent systems are going to touch money and inventory, “we resumed the session” is not an incident response. Reconcile what the world already did.*
