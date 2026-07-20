#!/usr/bin/env bash
set -euo pipefail
export DATABASE_URL="${DATABASE_URL:-postgres://rar:rar@localhost:5432/rar}"
export EVIDENCE_HMAC_SECRET="${EVIDENCE_HMAC_SECRET:-dev-evidence-hmac-secret-change-me-32b}"
export TEMPORAL_DISABLED="${TEMPORAL_DISABLED:-1}"

echo "== verify:ship DATABASE_URL=$DATABASE_URL =="
npm run typecheck
npm run build
npm run migrate
npm run seed
npm test
npm run demo:payment-crash
test -f docs/examples/evidence-payment-crash.json
echo "== verify:ship PASS =="
