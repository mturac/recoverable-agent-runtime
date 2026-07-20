# Threat model (summary)

## Assets

- Effect ledger integrity
- Idempotency keys and external receipts
- Evidence packets
- Service tokens / HMAC secrets

## Threats

| Threat | Mitigation |
|--------|------------|
| Double payment on retry | Stable idempotency key + provider uniqueness + no blind retry of unknown |
| Stale worker writes | Monotonic fencing tokens on leases |
| Session resume as attack to re-fire tools | Resume never consumes grants or dispatches effects |
| Forged evidence | Hash chain + HMAC |
| Secret leakage | Redaction, env-only secrets, no secrets in repo |
| Abuse of ops API | Bearer auth + rate limit |

## Trust boundaries

- Providers hold authoritative external state independent of platform ledger
- Platform must reconcile, not invent, external outcomes
