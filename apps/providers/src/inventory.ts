import { randomUUID } from "node:crypto";
import type { Sql } from "./db.js";

export interface Reservation {
  id: string;
  orderId: string;
  sku: string;
  quantity: number;
  idempotencyKey: string;
  status: string;
}

export async function reserveInventory(
  sql: Sql,
  req: {
    orderId: string;
    sku: string;
    quantity: number;
    idempotencyKey: string;
  },
): Promise<Reservation> {
  const existing = await sql<Reservation[]>`
    SELECT id, order_id AS "orderId", sku, quantity,
           idempotency_key AS "idempotencyKey", status
    FROM inventory.reservations
    WHERE idempotency_key = ${req.idempotencyKey}
    LIMIT 1
  `;
  if (existing[0]) return existing[0];

  const id = `res_${randomUUID()}`;
  await sql`
    INSERT INTO inventory.reservations
      (id, order_id, sku, quantity, idempotency_key, status)
    VALUES (
      ${id}, ${req.orderId}, ${req.sku}, ${req.quantity},
      ${req.idempotencyKey}, ${"reserved"}
    )
  `;
  return {
    id,
    orderId: req.orderId,
    sku: req.sku,
    quantity: req.quantity,
    idempotencyKey: req.idempotencyKey,
    status: "reserved",
  };
}

export async function releaseInventory(
  sql: Sql,
  reservationId: string,
): Promise<Reservation | null> {
  const rows = await sql<Reservation[]>`
    SELECT id, order_id AS "orderId", sku, quantity,
           idempotency_key AS "idempotencyKey", status
    FROM inventory.reservations WHERE id = ${reservationId} LIMIT 1
  `;
  const res = rows[0];
  if (!res) return null;
  if (res.status === "released") return res;
  await sql`
    UPDATE inventory.reservations
    SET status = 'released', updated_at = now()
    WHERE id = ${reservationId}
  `;
  return { ...res, status: "released" };
}

export async function reconcileInventory(
  sql: Sql,
  query: { idempotencyKey?: string; orderId?: string; reservationId?: string },
): Promise<Reservation[]> {
  if (query.idempotencyKey) {
    return sql<Reservation[]>`
      SELECT id, order_id AS "orderId", sku, quantity,
             idempotency_key AS "idempotencyKey", status
      FROM inventory.reservations
      WHERE idempotency_key = ${query.idempotencyKey}
    `;
  }
  if (query.reservationId) {
    return sql<Reservation[]>`
      SELECT id, order_id AS "orderId", sku, quantity,
             idempotency_key AS "idempotencyKey", status
      FROM inventory.reservations WHERE id = ${query.reservationId}
    `;
  }
  if (query.orderId) {
    return sql<Reservation[]>`
      SELECT id, order_id AS "orderId", sku, quantity,
             idempotency_key AS "idempotencyKey", status
      FROM inventory.reservations WHERE order_id = ${query.orderId}
    `;
  }
  return [];
}
