import { randomUUID } from "node:crypto";
import type { Sql } from "./db.js";

export interface EmailMessage {
  id: string;
  orderId: string;
  toAddress: string;
  subject: string;
  idempotencyKey: string;
  status: string;
}

export async function sendEmail(
  sql: Sql,
  req: {
    orderId: string;
    toAddress: string;
    subject: string;
    idempotencyKey: string;
  },
): Promise<EmailMessage> {
  const existing = await sql<EmailMessage[]>`
    SELECT id, order_id AS "orderId", to_address AS "toAddress",
           subject, idempotency_key AS "idempotencyKey", status
    FROM email.messages
    WHERE idempotency_key = ${req.idempotencyKey}
    LIMIT 1
  `;
  if (existing[0]) return existing[0];

  const id = `em_${randomUUID()}`;
  await sql`
    INSERT INTO email.messages
      (id, order_id, to_address, subject, idempotency_key, status)
    VALUES (
      ${id}, ${req.orderId}, ${req.toAddress}, ${req.subject},
      ${req.idempotencyKey}, ${"sent"}
    )
  `;
  return {
    id,
    orderId: req.orderId,
    toAddress: req.toAddress,
    subject: req.subject,
    idempotencyKey: req.idempotencyKey,
    status: "sent",
  };
}

export async function reconcileEmail(
  sql: Sql,
  query: { idempotencyKey?: string; orderId?: string },
): Promise<EmailMessage[]> {
  if (query.idempotencyKey) {
    return sql<EmailMessage[]>`
      SELECT id, order_id AS "orderId", to_address AS "toAddress",
             subject, idempotency_key AS "idempotencyKey", status
      FROM email.messages WHERE idempotency_key = ${query.idempotencyKey}
    `;
  }
  if (query.orderId) {
    return sql<EmailMessage[]>`
      SELECT id, order_id AS "orderId", to_address AS "toAddress",
             subject, idempotency_key AS "idempotencyKey", status
      FROM email.messages WHERE order_id = ${query.orderId}
    `;
  }
  return [];
}
