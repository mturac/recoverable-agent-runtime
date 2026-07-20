import Fastify from "fastify";
import { createSql } from "./db.js";
import * as payment from "./payment.js";
import * as inventory from "./inventory.js";
import * as email from "./email.js";
import * as crm from "./crm.js";

const port = Number(process.env.PROVIDERS_PORT ?? 8090);
const host = process.env.PROVIDERS_HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  const sql = createSql();
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    ok: true,
    service: "providers",
    providers: ["inventory", "payment", "email", "crm"],
  }));

  // Payment
  app.post<{ Body: payment.CaptureRequest }>("/payment/capture", async (req, reply) => {
    const result = await payment.capturePayment(sql, req.body);
    if (result.kind === "mismatch") {
      return reply.code(409).send(result);
    }
    if (result.kind === "delayed") {
      return reply.code(202).send(result);
    }
    if (result.responseLost) {
      // Committed but response withheld (failure injection)
      return reply.code(504).send({ kind: "response_lost", committed: true });
    }
    return result.payment;
  });

  app.get("/payment/reconcile", async (req) => {
    const q = req.query as {
      idempotencyKey?: string;
      paymentId?: string;
      orderId?: string;
    };
    return payment.reconcilePayment(sql, q);
  });

  app.post<{
    Body: { scenarioId: string; responseLossAfterCommit?: boolean; delayMs?: number };
  }>("/payment/injection", async (req) => {
    await payment.armPaymentInjection(sql, req.body.scenarioId, req.body);
    return { ok: true };
  });

  app.post<{ Body: { paymentId: string; idempotencyKey: string } }>(
    "/payment/refund",
    async (req, reply) => {
      const rec = await payment.refundPayment(
        sql,
        req.body.paymentId,
        req.body.idempotencyKey,
      );
      if (!rec) return reply.code(404).send({ error: "not_found" });
      return rec;
    },
  );

  // Inventory
  app.post("/inventory/reserve", async (req) => {
    return inventory.reserveInventory(
      sql,
      req.body as {
        orderId: string;
        sku: string;
        quantity: number;
        idempotencyKey: string;
      },
    );
  });
  app.post<{ Body: { reservationId: string } }>("/inventory/release", async (req, reply) => {
    const rec = await inventory.releaseInventory(sql, req.body.reservationId);
    if (!rec) return reply.code(404).send({ error: "not_found" });
    return rec;
  });
  app.get("/inventory/reconcile", async (req) => {
    return inventory.reconcileInventory(
      sql,
      req.query as {
        idempotencyKey?: string;
        orderId?: string;
        reservationId?: string;
      },
    );
  });

  // Email
  app.post("/email/send", async (req) => {
    return email.sendEmail(
      sql,
      req.body as {
        orderId: string;
        toAddress: string;
        subject: string;
        idempotencyKey: string;
      },
    );
  });
  app.get("/email/reconcile", async (req) => {
    return email.reconcileEmail(
      sql,
      req.query as { idempotencyKey?: string; orderId?: string },
    );
  });

  // CRM
  app.post("/crm/update", async (req) => {
    return crm.updateCrm(
      sql,
      req.body as {
        orderId: string;
        status: string;
        payload: Record<string, unknown>;
        idempotencyKey: string;
      },
    );
  });
  app.post<{ Body: { orderId: string } }>("/crm/reverse", async (req, reply) => {
    const rec = await crm.reverseCrm(sql, req.body.orderId);
    if (!rec) return reply.code(404).send({ error: "not_found" });
    return rec;
  });
  app.get("/crm/reconcile", async (req) => {
    return crm.reconcileCrm(
      sql,
      req.query as { orderId?: string; idempotencyKey?: string },
    );
  });

  await app.listen({ port, host });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
