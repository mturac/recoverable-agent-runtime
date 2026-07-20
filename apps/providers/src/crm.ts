import { randomUUID } from "node:crypto";
import type { Sql } from "./db.js";

export interface CrmRecord {
  id: string;
  orderId: string;
  status: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  reversed: boolean;
}

export async function updateCrm(
  sql: Sql,
  req: {
    orderId: string;
    status: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<CrmRecord> {
  const existing = await sql<CrmRecord[]>`
    SELECT id, order_id AS "orderId", status, payload,
           idempotency_key AS "idempotencyKey", reversed
    FROM crm.records WHERE idempotency_key = ${req.idempotencyKey} LIMIT 1
  `;
  if (existing[0]) return existing[0];

  const id = `crm_${randomUUID()}`;
  await sql`
    INSERT INTO crm.records
      (id, order_id, status, payload, idempotency_key, reversed)
    VALUES (
      ${id},
      ${req.orderId},
      ${req.status},
      ${sql.json(JSON.parse(JSON.stringify(req.payload)))},
      ${req.idempotencyKey},
      ${false}
    )
  `;
  return {
    id,
    orderId: req.orderId,
    status: req.status,
    payload: req.payload,
    idempotencyKey: req.idempotencyKey,
    reversed: false,
  };
}

export async function reverseCrm(
  sql: Sql,
  orderId: string,
): Promise<CrmRecord | null> {
  const rows = await sql<CrmRecord[]>`
    SELECT id, order_id AS "orderId", status, payload,
           idempotency_key AS "idempotencyKey", reversed
    FROM crm.records WHERE order_id = ${orderId} LIMIT 1
  `;
  const rec = rows[0];
  if (!rec) return null;
  if (rec.reversed) return rec;
  await sql`
    UPDATE crm.records
    SET reversed = true, status = 'reversed', updated_at = now()
    WHERE order_id = ${orderId}
  `;
  return { ...rec, reversed: true, status: "reversed" };
}

export async function reconcileCrm(
  sql: Sql,
  query: { orderId?: string; idempotencyKey?: string },
): Promise<CrmRecord[]> {
  if (query.idempotencyKey) {
    return sql<CrmRecord[]>`
      SELECT id, order_id AS "orderId", status, payload,
             idempotency_key AS "idempotencyKey", reversed
      FROM crm.records WHERE idempotency_key = ${query.idempotencyKey}
    `;
  }
  if (query.orderId) {
    return sql<CrmRecord[]>`
      SELECT id, order_id AS "orderId", status, payload,
             idempotency_key AS "idempotencyKey", reversed
      FROM crm.records WHERE order_id = ${query.orderId}
    `;
  }
  return [];
}
