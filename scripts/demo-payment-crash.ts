/**
 * Mandatory payment-crash demonstration (spec §10 / REQ-21).
 *
 * Proves: session resume ≠ execution recovery; unknown payment is reconciled
 * with the original idempotency key — never blindly re-captured.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  armPaymentCrashScenario,
  clearAllScenarios,
  PAYMENT_CRASH_SCENARIO,
} from "@rar/testkit";
import {
  runFulfillment,
  recoverPaymentCrash,
} from "../apps/worker/src/fulfillment/engine.js";
import {
  acpInitialize,
  sessionNew,
  sessionResume,
  sessionPrompt,
} from "@rar/acp";
import { buildEvidencePacket, verifyEvidencePacket } from "@rar/evidence";
import { createSql } from "@rar/providers/db";
import { countPaymentsByKey } from "@rar/providers/payment";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log("=== Recoverable Agent Runtime: payment_crash_after_commit ===\n");

  clearAllScenarios();
  armPaymentCrashScenario();

  const principalId = "principal_demo_human";
  const orderId = `ord_demo_${randomUUID().slice(0, 8)}`;

  // ACP session (separate from workflow)
  const init = acpInitialize();
  console.log("1. ACP initialize", init.serverName);

  const session = await sessionNew({ principalId });
  console.log("2. session/new", session.sessionId);

  // Run fulfillment until payment crash
  console.log("3–5. create order, reserve inventory, capture payment (crash after commit)...");
  const crashResult = await runFulfillment({
    principalId,
    orderId,
    amountCents: 9999,
    currency: "USD",
    sku: "SKU-DEMO",
    quantity: 1,
    emailTo: "demo@example.com",
    scenarioId: PAYMENT_CRASH_SCENARIO,
    workerId: "worker_demo_crash",
  });

  assert(crashResult.completed === false, "expected crash before completion");
  assert(crashResult.crashed, "expected crash metadata");
  assert(
    crashResult.crashed.step === "capture_payment",
    "expected crash on capture_payment",
  );
  console.log("   crashed at", crashResult.crashed.boundary);
  console.log("   workflowId", crashResult.workflowId);
  console.log("   idempotencyKey", crashResult.crashed.idempotencyKey);

  // 6–7 Resume session — must not retry payment
  const resume1 = await sessionResume({ sessionId: session.sessionId });
  assert(resume1.effectsRetried === false, "session resume retried effects");
  assert(resume1.grantsConsumed === false, "session resume consumed grants");
  console.log("6–7. session/resume: effectsRetried=false grantsConsumed=false");

  await sessionPrompt({
    sessionId: session.sessionId,
    prompt: "What happened to my payment?",
  });

  // Correlate session with workflow (control plane only — no auto effect)
  console.log("8. effect already marked unknown at crash");
  console.log("9–13. acquire fenced lease + reconcile by original idempotency key...");

  const recovered = await recoverPaymentCrash({
    workflowId: crashResult.workflowId,
    operationId: crashResult.crashed.operationId,
    idempotencyKey: crashResult.crashed.idempotencyKey,
    principalId,
    workerId: "worker_demo_recovery",
  });

  assert(recovered.classification === "confirmed_success", "expected confirmed_success");
  assert(recovered.decision === "continue", "expected continue decision");
  console.log("   classification", recovered.classification);
  console.log("   decision", recovered.decision);
  console.log("   paymentId", recovered.paymentId);
  console.log("   receiptId", recovered.receiptId);

  // 14 exactly one payment
  const sql = createSql();
  try {
    const n = await countPaymentsByKey(
      sql,
      crashResult.crashed.idempotencyKey,
    );
    assert(n === 1, `expected exactly 1 payment, got ${n}`);
    console.log("14. payment count =", n);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // 15 Evidence Packet
  const secret =
    process.env.EVIDENCE_HMAC_SECRET ?? "dev-evidence-hmac-secret-change-me-32b";
  const packet = buildEvidencePacket({
    workflowId: crashResult.workflowId,
    secret,
    entries: [
      { kind: "session", payload: { sessionId: session.sessionId, resume: resume1 } },
      {
        kind: "crash",
        payload: {
          boundary: crashResult.crashed.boundary,
          step: crashResult.crashed.step,
          idempotencyKey: crashResult.crashed.idempotencyKey,
        },
      },
      {
        kind: "reconciliation",
        payload: {
          classification: recovered.classification,
          decision: recovered.decision,
          paymentId: recovered.paymentId,
        },
      },
      { kind: "receipt", payload: { receiptId: recovered.receiptId } },
      {
        kind: "verification",
        payload: {
          paymentCount: 1,
          sessionDidNotRetry: true,
          invariant: "one_logical_payment",
        },
      },
    ],
  });
  const v = verifyEvidencePacket(packet, secret);
  assert(v.ok, `evidence verify failed: ${"reason" in v ? v.reason : ""}`);

  const outDir = path.resolve("docs/examples");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "evidence-payment-crash.json");
  await writeFile(outFile, JSON.stringify(packet, null, 2));
  console.log("15. Evidence Packet exported →", outFile);

  console.log("\nPASS: payment_crash_after_commit demo complete.");
  console.log(
    "Proved: session resume ≠ payment retry; reconcile recovered single payment.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
