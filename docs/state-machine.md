# Recovery state machine

States: planned → authorization_pending → authorized → execution_started →
effect_requested → effect_unknown | effect_observed → verification_pending →
verified | rejected | interrupted | partially_applied | reconciliation_required |
compensation_required → compensating → compensated | manual_review

All transitions use optimistic concurrency (`version`).

Illegal transitions throw. Unknown effects go to reconciliation or manual_review —
never directly to blind re-execute of a mutation.
