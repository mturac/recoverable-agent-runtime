# Recovery runbook

## Payment crash (unknown after commit)

1. Confirm session resume did **not** re-capture payment.
2. Note `workflowId`, `operationId`, `idempotencyKey` from ledger.
3. Acquire fenced lease as recovery worker.
4. Issue **recovery** grant (not execution grant).
5. Reconcile payment provider by original idempotency key.
6. If `confirmed_success`, persist missing external receipt; **do not** call capture again.
7. Continue workflow; verify payment count = 1.
8. Export Evidence Packet.

```bash
npm run demo:payment-crash
```

## Manual review

When reconciliation returns `unknown` or `partially_applied`, set workflow to
`manual_review` and require a human principal with recovery grant.
