import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createSql, type Sql } from "./db.js";
import * as inventory from "./inventory.js";
import * as email from "./email.js";
import * as crm from "./crm.js";

describe("inventory / email / crm providers (REQ-18)", () => {
  let sql: Sql;
  beforeAll(() => {
    sql = createSql(
      process.env.DATABASE_URL ?? "postgres://rar:rar@localhost:5432/rar",
    );
  });

  it("reserves inventory idempotently and reconciles", async () => {
    const key = `idem_inv_${randomUUID()}`;
    const orderId = `ord_${randomUUID()}`;
    const a = await inventory.reserveInventory(sql, {
      orderId,
      sku: "SKU-1",
      quantity: 2,
      idempotencyKey: key,
    });
    const b = await inventory.reserveInventory(sql, {
      orderId,
      sku: "SKU-1",
      quantity: 2,
      idempotencyKey: key,
    });
    expect(a.id).toBe(b.id);
    const rows = await inventory.reconcileInventory(sql, { orderId });
    expect(rows).toHaveLength(1);
    const released = await inventory.releaseInventory(sql, a.id);
    expect(released?.status).toBe("released");
  });

  it("sends email once per idempotency key", async () => {
    const key = `idem_em_${randomUUID()}`;
    const orderId = `ord_${randomUUID()}`;
    const a = await email.sendEmail(sql, {
      orderId,
      toAddress: "buyer@example.com",
      subject: "Order conf",
      idempotencyKey: key,
    });
    const b = await email.sendEmail(sql, {
      orderId,
      toAddress: "buyer@example.com",
      subject: "Order conf",
      idempotencyKey: key,
    });
    expect(a.id).toBe(b.id);
    const found = await email.reconcileEmail(sql, { idempotencyKey: key });
    expect(found).toHaveLength(1);
  });

  it("updates CRM and reverses", async () => {
    const key = `idem_crm_${randomUUID()}`;
    const orderId = `ord_${randomUUID()}`;
    const rec = await crm.updateCrm(sql, {
      orderId,
      status: "fulfilled",
      payload: { stage: "closed" },
      idempotencyKey: key,
    });
    expect(rec.reversed).toBe(false);
    const rev = await crm.reverseCrm(sql, orderId);
    expect(rev?.reversed).toBe(true);
    const rows = await crm.reconcileCrm(sql, { orderId });
    expect(rows[0]?.reversed).toBe(true);
  });
});
