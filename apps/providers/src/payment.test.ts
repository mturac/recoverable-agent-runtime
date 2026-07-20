import { describe, expect, it, beforeAll } from "vitest";
import { createSql, type Sql } from "./db.js";
import {
  armPaymentInjection,
  capturePayment,
  countPaymentsByKey,
  reconcilePayment,
} from "./payment.js";
import { randomUUID } from "node:crypto";

describe("payment provider contracts (REQ-19)", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createSql(
      process.env.DATABASE_URL ?? "postgres://rar:rar@localhost:5432/rar",
    );
  });

  it("returns same payment for matching idempotency retries", async () => {
    const key = `idem_pay_${randomUUID()}`;
    const req = {
      orderId: `ord_${randomUUID()}`,
      amountCents: 2500,
      currency: "USD",
      idempotencyKey: key,
    };
    const a = await capturePayment(sql, req);
    const b = await capturePayment(sql, req);
    expect(a.kind).toBe("success");
    expect(b.kind).toBe("success");
    if (a.kind === "success" && b.kind === "success") {
      expect(a.payment.id).toBe(b.payment.id);
    }
    expect(await countPaymentsByKey(sql, key)).toBe(1);
  });

  it("rejects same key with different material params", async () => {
    const key = `idem_pay_${randomUUID()}`;
    const orderId = `ord_${randomUUID()}`;
    await capturePayment(sql, {
      orderId,
      amountCents: 1000,
      currency: "USD",
      idempotencyKey: key,
    });
    const mismatch = await capturePayment(sql, {
      orderId,
      amountCents: 9999,
      currency: "USD",
      idempotencyKey: key,
    });
    expect(mismatch.kind).toBe("mismatch");
    expect(await countPaymentsByKey(sql, key)).toBe(1);
  });

  it("reconciles by idempotency key, payment id, and order id", async () => {
    const key = `idem_pay_${randomUUID()}`;
    const orderId = `ord_${randomUUID()}`;
    const res = await capturePayment(sql, {
      orderId,
      amountCents: 500,
      currency: "USD",
      idempotencyKey: key,
    });
    expect(res.kind).toBe("success");
    if (res.kind !== "success") return;
    const byKey = await reconcilePayment(sql, { idempotencyKey: key });
    const byPay = await reconcilePayment(sql, { paymentId: res.payment.id });
    const byOrd = await reconcilePayment(sql, { orderId });
    expect(byKey).toHaveLength(1);
    expect(byPay[0]?.id).toBe(res.payment.id);
    expect(byOrd[0]?.id).toBe(res.payment.id);
  });

  it("supports response loss after commit", async () => {
    const scenarioId = `scenario_${randomUUID()}`;
    await armPaymentInjection(sql, scenarioId, {
      responseLossAfterCommit: true,
    });
    const key = `idem_pay_${randomUUID()}`;
    const res = await capturePayment(sql, {
      orderId: `ord_${randomUUID()}`,
      amountCents: 700,
      currency: "USD",
      idempotencyKey: key,
      scenarioId,
    });
    expect(res.kind).toBe("success");
    if (res.kind === "success") {
      expect(res.responseLost).toBe(true);
      expect(res.payment.status).toBe("captured");
    }
    expect(await countPaymentsByKey(sql, key)).toBe(1);
  });

  it("duplicate network delivery does not create second payment", async () => {
    const key = `idem_pay_${randomUUID()}`;
    const req = {
      orderId: `ord_${randomUUID()}`,
      amountCents: 100,
      currency: "USD",
      idempotencyKey: key,
    };
    await Promise.all([
      capturePayment(sql, req),
      capturePayment(sql, req),
      capturePayment(sql, req),
    ]);
    expect(await countPaymentsByKey(sql, key)).toBe(1);
  });
});
