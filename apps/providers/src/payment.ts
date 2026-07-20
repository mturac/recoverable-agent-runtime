import { randomUUID } from "node:crypto";
import type { Sql } from "./db.js";
import { fingerprint } from "./hash.js";

export interface CaptureRequest {
  orderId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  scenarioId?: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  status: string;
  requestFingerprint: string;
}

export type CaptureResult =
  | { kind: "success"; payment: PaymentRecord; responseLost: boolean }
  | { kind: "mismatch"; message: string }
  | { kind: "delayed"; paymentId: string };

function materialParams(req: CaptureRequest) {
  return {
    orderId: req.orderId,
    amountCents: req.amountCents,
    currency: req.currency,
  };
}

export async function capturePayment(
  sql: Sql,
  req: CaptureRequest,
): Promise<CaptureResult> {
  const fp = fingerprint(materialParams(req));
  const historyId = randomUUID();

  const existing = await sql<PaymentRecord[]>`
    SELECT id, order_id AS "orderId", amount_cents AS "amountCents",
           currency, idempotency_key AS "idempotencyKey", status,
           request_fingerprint AS "requestFingerprint"
    FROM payment.payments
    WHERE idempotency_key = ${req.idempotencyKey}
    LIMIT 1
  `;

  if (existing.length > 0) {
    const pay = existing[0]!;
    if (pay.requestFingerprint !== fp) {
      await sql`
        INSERT INTO payment.request_history
          (id, idempotency_key, request_fingerprint, request_body, outcome, payment_id)
        VALUES (
          ${historyId},
          ${req.idempotencyKey},
          ${fp},
          ${sql.json(JSON.parse(JSON.stringify(req)))},
          ${"rejected_mismatch"},
          ${pay.id}
        )
      `;
      return {
        kind: "mismatch",
        message:
          "idempotency key reused with materially different parameters",
      };
    }
    await sql`
      INSERT INTO payment.request_history
        (id, idempotency_key, request_fingerprint, request_body, outcome, payment_id)
      VALUES (
        ${historyId},
        ${req.idempotencyKey},
        ${fp},
        ${sql.json(JSON.parse(JSON.stringify(req)))},
        ${"duplicate_delivery"},
        ${pay.id}
      )
    `;
    return { kind: "success", payment: pay, responseLost: false };
  }

  let delayMs = 0;
  let responseLoss = false;
  if (req.scenarioId) {
    const cfg = await sql<{ delay_ms: number; response_loss_after_commit: boolean }[]>`
      SELECT delay_ms, response_loss_after_commit
      FROM payment.injection_config
      WHERE scenario_id = ${req.scenarioId}
      LIMIT 1
    `;
    if (cfg[0]) {
      delayMs = cfg[0].delay_ms;
      responseLoss = cfg[0].response_loss_after_commit;
    }
  }

  if (delayMs > 0) {
    // Accept and complete asynchronously: insert pending then flip after delay
    // is simulated by immediate insert as captured for local determinism of
    // delayed path with status pending until caller polls reconcile.
    const paymentId = `pay_${randomUUID()}`;
    await sql`
      INSERT INTO payment.payments
        (id, order_id, amount_cents, currency, idempotency_key, status, request_fingerprint)
      VALUES (
        ${paymentId},
        ${req.orderId},
        ${req.amountCents},
        ${req.currency},
        ${req.idempotencyKey},
        ${"pending"},
        ${fp}
      )
    `;
    await sql`
      INSERT INTO payment.request_history
        (id, idempotency_key, request_fingerprint, request_body, outcome, payment_id)
      VALUES (
        ${historyId},
        ${req.idempotencyKey},
        ${fp},
        ${sql.json(JSON.parse(JSON.stringify(req)))},
        ${"accepted_delayed"},
        ${paymentId}
      )
    `;
    // Simulate async completion
    await sql`
      UPDATE payment.payments SET status = 'captured', updated_at = now()
      WHERE id = ${paymentId}
    `;
    return { kind: "delayed", paymentId };
  }

  const paymentId = `pay_${randomUUID()}`;
  try {
    await sql`
      INSERT INTO payment.payments
        (id, order_id, amount_cents, currency, idempotency_key, status, request_fingerprint)
      VALUES (
        ${paymentId},
        ${req.orderId},
        ${req.amountCents},
        ${req.currency},
        ${req.idempotencyKey},
        ${"captured"},
        ${fp}
      )
    `;
  } catch (err) {
    // Concurrent duplicate delivery: unique on idempotency_key
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "23505") {
      return capturePayment(sql, req);
    }
    throw err;
  }
  await sql`
    INSERT INTO payment.request_history
      (id, idempotency_key, request_fingerprint, request_body, outcome, payment_id)
    VALUES (
      ${historyId},
      ${req.idempotencyKey},
      ${fp},
      ${sql.json(JSON.parse(JSON.stringify(req)))},
      ${responseLoss ? "committed_response_lost" : "committed"},
      ${paymentId}
    )
  `;

  const payment: PaymentRecord = {
    id: paymentId,
    orderId: req.orderId,
    amountCents: req.amountCents,
    currency: req.currency,
    idempotencyKey: req.idempotencyKey,
    status: "captured",
    requestFingerprint: fp,
  };

  return { kind: "success", payment, responseLost: responseLoss };
}

export async function reconcilePayment(
  sql: Sql,
  query: { idempotencyKey?: string; paymentId?: string; orderId?: string },
): Promise<PaymentRecord[]> {
  if (query.idempotencyKey) {
    return sql<PaymentRecord[]>`
      SELECT id, order_id AS "orderId", amount_cents AS "amountCents",
             currency, idempotency_key AS "idempotencyKey", status,
             request_fingerprint AS "requestFingerprint"
      FROM payment.payments
      WHERE idempotency_key = ${query.idempotencyKey}
    `;
  }
  if (query.paymentId) {
    return sql<PaymentRecord[]>`
      SELECT id, order_id AS "orderId", amount_cents AS "amountCents",
             currency, idempotency_key AS "idempotencyKey", status,
             request_fingerprint AS "requestFingerprint"
      FROM payment.payments
      WHERE id = ${query.paymentId}
    `;
  }
  if (query.orderId) {
    return sql<PaymentRecord[]>`
      SELECT id, order_id AS "orderId", amount_cents AS "amountCents",
             currency, idempotency_key AS "idempotencyKey", status,
             request_fingerprint AS "requestFingerprint"
      FROM payment.payments
      WHERE order_id = ${query.orderId}
    `;
  }
  return [];
}

export async function armPaymentInjection(
  sql: Sql,
  scenarioId: string,
  opts: { responseLossAfterCommit?: boolean; delayMs?: number },
): Promise<void> {
  await sql`
    INSERT INTO payment.injection_config
      (scenario_id, response_loss_after_commit, delay_ms, updated_at)
    VALUES (
      ${scenarioId},
      ${opts.responseLossAfterCommit ?? false},
      ${opts.delayMs ?? 0},
      now()
    )
    ON CONFLICT (scenario_id) DO UPDATE SET
      response_loss_after_commit = EXCLUDED.response_loss_after_commit,
      delay_ms = EXCLUDED.delay_ms,
      updated_at = now()
  `;
}

export async function refundPayment(
  sql: Sql,
  paymentId: string,
  idempotencyKey: string,
): Promise<PaymentRecord | null> {
  const rows = await sql<PaymentRecord[]>`
    SELECT id, order_id AS "orderId", amount_cents AS "amountCents",
           currency, idempotency_key AS "idempotencyKey", status,
           request_fingerprint AS "requestFingerprint"
    FROM payment.payments WHERE id = ${paymentId} LIMIT 1
  `;
  const pay = rows[0];
  if (!pay) return null;
  if (pay.status === "refunded") return pay;
  await sql`
    UPDATE payment.payments SET status = 'refunded', updated_at = now()
    WHERE id = ${paymentId}
  `;
  await sql`
    INSERT INTO payment.request_history
      (id, idempotency_key, request_fingerprint, request_body, outcome, payment_id)
    VALUES (
      ${randomUUID()},
      ${idempotencyKey},
      ${pay.requestFingerprint},
      ${sql.json(JSON.parse(JSON.stringify({ paymentId, action: "refund" })))},
      ${"refunded"},
      ${paymentId}
    )
  `;
  return { ...pay, status: "refunded" };
}

export async function countPaymentsByKey(
  sql: Sql,
  idempotencyKey: string,
): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM payment.payments
    WHERE idempotency_key = ${idempotencyKey}
  `;
  return Number(rows[0]?.n ?? 0);
}
