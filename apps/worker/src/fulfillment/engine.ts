/**
 * Order-fulfillment execution engine.
 * Temporal activities and demo:payment-crash call this.
 * ACP session/resume never invokes this automatically.
 */

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  asOperationId,
  asWorkflowId,
  stableIdempotencyKey,
  type FulfillmentStepName,
} from "@rar/domain";
import {
  createDb,
  effectLedgerEntries,
  operations as opsTable,
  principals,
  repos,
  services,
} from "@rar/db";
import {
  FailureInjectionError,
  maybeInject,
  PAYMENT_CRASH_SCENARIO,
} from "@rar/testkit";
import * as paymentProvider from "@rar/providers/payment";
import * as inventoryProvider from "@rar/providers/inventory";
import * as emailProvider from "@rar/providers/email";
import * as crmProvider from "@rar/providers/crm";
import { createSql } from "@rar/providers/db";

export interface FulfillmentInput {
  principalId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  sku: string;
  quantity: number;
  emailTo: string;
  scenarioId?: string;
  workerId?: string;
}

export interface CrashMeta {
  step: FulfillmentStepName;
  boundary: string;
  operationId: string;
  idempotencyKey: string;
  fencingToken: string;
  ledgerEntryId: string;
}

export interface FulfillmentResult {
  workflowId: string;
  orderId: string;
  crashed?: CrashMeta;
  completed: boolean;
  paymentId?: string;
  steps: string[];
}

export async function runFulfillment(
  input: FulfillmentInput,
): Promise<FulfillmentResult> {
  const { db, sql: platformSql } = createDb();
  const pSql = createSql();
  const workerId = input.workerId ?? `worker_${randomUUID()}`;
  const workflowId = `wf_${randomUUID()}`;
  const steps: string[] = [];
  let paymentId: string | undefined;
  let workflowVersion = 0;

  try {
    await db
      .insert(principals)
      .values({ id: input.principalId, displayName: input.principalId, kind: "human" })
      .onConflictDoNothing();

    await repos.workflows.insertWorkflow(
      { db },
      {
        id: workflowId,
        principalId: input.principalId,
        kind: "order_fulfillment",
        recoveryState: "execution_started",
        version: 0,
        orderId: input.orderId,
      },
    );

    const lease = await services.acquireLease(
      { db },
      workflowId,
      workerId,
      120_000,
    );

    const runStep = async (
      step: FulfillmentStepName,
      opName: string,
      mutationKind: string,
      fn: (args: {
        operationId: string;
        idempotencyKey: string;
      }) => Promise<{ externalId?: string; payload?: unknown }>,
    ) => {
      const operationId = `op_${step}_${randomUUID()}`;
      const idempotencyKey = String(
        stableIdempotencyKey(
          asWorkflowId(workflowId),
          asOperationId(operationId),
        ),
      );
      const attemptId = `att_${randomUUID()}`;

      await db.insert(opsTable).values({
        id: operationId,
        workflowId,
        operationName: opName,
        recoveryState: "execution_started",
        version: 0,
        idempotencyKey,
        mutationKind,
      });

      maybeInject(input.scenarioId, "before_request_dispatch", step);

      const entry = await services.recordAttempt(
        { db },
        {
          workflowId,
          operationId,
          attemptId,
          attemptNumber: 1,
          workerId,
          fencingToken: lease.fencingToken,
          idempotencyKey,
          requestPayload: { step, orderId: input.orderId },
        },
      );

      maybeInject(input.scenarioId, "after_request_dispatch", step);

      let external: { externalId?: string; payload?: unknown };
      try {
        external = await fn({ operationId, idempotencyKey });
      } catch (err) {
        if (err instanceof FailureInjectionError) {
          await services.markUnknown(
            { db },
            {
              ledgerEntryId: entry.id,
              workflowId,
              workerId,
              fencingToken: lease.fencingToken,
            },
          );
          throw err;
        }
        throw err;
      }

      try {
        maybeInject(
          input.scenarioId,
          "after_external_commit_before_response",
          step,
        );
      } catch (err) {
        if (err instanceof FailureInjectionError) {
          await services.markUnknown(
            { db },
            {
              ledgerEntryId: entry.id,
              workflowId,
              workerId,
              fencingToken: lease.fencingToken,
            },
          );
          await services.updateOperationStateFenced(
            { db },
            {
              operationId,
              workflowId,
              workerId,
              fencingToken: lease.fencingToken,
              recoveryState: "effect_unknown",
              expectedVersion: 0,
            },
          );
          const ver = await repos.workflows.updateWorkflowState(
            { db },
            workflowId,
            "effect_unknown",
            workflowVersion,
          );
          if (ver.ok) workflowVersion = ver.version;
          const crash: CrashMeta = {
            step,
            boundary: err.boundary,
            operationId,
            idempotencyKey,
            fencingToken: lease.fencingToken.toString(),
            ledgerEntryId: entry.id,
          };
          throw Object.assign(err, { crashMeta: crash });
        }
        throw err;
      }

      const receiptId = `rcpt_${randomUUID()}`;
      await services.persistExternalReceipt(
        { db },
        {
          receiptId,
          provider: step,
          externalId: external.externalId ?? receiptId,
          idempotencyKey,
          payload: external.payload ?? {},
        },
      );

      maybeInject(input.scenarioId, "after_response_before_receipt", step);

      await services.markConfirmedSuccess(
        { db },
        {
          ledgerEntryId: entry.id,
          workflowId,
          workerId,
          fencingToken: lease.fencingToken,
          externalReceiptId: receiptId,
          responsePayload: external.payload ?? {},
        },
      );

      maybeInject(
        input.scenarioId,
        "after_receipt_before_workflow_transition",
        step,
      );

      await services.updateOperationStateFenced(
        { db },
        {
          operationId,
          workflowId,
          workerId,
          fencingToken: lease.fencingToken,
          recoveryState: "effect_observed",
          expectedVersion: 0,
        },
      );

      steps.push(step);
      return { operationId, external };
    };

    await runStep("create_order", "order.create", "idempotent_mutation", async () => ({
      externalId: input.orderId,
      payload: { orderId: input.orderId },
    }));

    await runStep(
      "reserve_inventory",
      "inventory.reserve",
      "compensatable_mutation",
      async ({ idempotencyKey }) => {
        const r = await inventoryProvider.reserveInventory(pSql, {
          orderId: input.orderId,
          sku: input.sku,
          quantity: input.quantity,
          idempotencyKey,
        });
        return { externalId: r.id, payload: r };
      },
    );

    try {
      await runStep(
        "capture_payment",
        "payment.capture",
        "compensatable_mutation",
        async ({ idempotencyKey }) => {
          const res = await paymentProvider.capturePayment(pSql, {
            orderId: input.orderId,
            amountCents: input.amountCents,
            currency: input.currency,
            idempotencyKey,
            scenarioId:
              input.scenarioId === PAYMENT_CRASH_SCENARIO
                ? input.scenarioId
                : undefined,
          });
          if (res.kind === "mismatch") throw new Error(res.message);
          if (res.kind === "delayed") {
            paymentId = res.paymentId;
            return { externalId: res.paymentId, payload: res };
          }
          paymentId = res.payment.id;
          return { externalId: res.payment.id, payload: res.payment };
        },
      );
    } catch (err) {
      if (err instanceof FailureInjectionError) {
        const crashMeta = (
          err as FailureInjectionError & { crashMeta?: CrashMeta }
        ).crashMeta;
        // Crash: drop lease so a recovery worker can acquire a higher fencing token
        try {
          await services.releaseLease(
            { db },
            workflowId,
            workerId,
            lease.fencingToken,
          );
        } catch {
          /* lease may already be unusable */
        }
        return {
          workflowId,
          orderId: input.orderId,
          completed: false,
          paymentId,
          steps,
          crashed: crashMeta,
        };
      }
      throw err;
    }

    await runStep(
      "generate_invoice",
      "invoice.generate",
      "compensatable_mutation",
      async () => ({
        externalId: `inv_${input.orderId}`,
        payload: { invoiceId: `inv_${input.orderId}` },
      }),
    );

    await runStep(
      "send_confirmation_email",
      "email.send_confirmation",
      "irreversible_mutation",
      async ({ idempotencyKey }) => {
        const m = await emailProvider.sendEmail(pSql, {
          orderId: input.orderId,
          toAddress: input.emailTo,
          subject: `Order ${input.orderId}`,
          idempotencyKey,
        });
        return { externalId: m.id, payload: m };
      },
    );

    await runStep(
      "update_crm",
      "crm.update_order",
      "compensatable_mutation",
      async ({ idempotencyKey }) => {
        const r = await crmProvider.updateCrm(pSql, {
          orderId: input.orderId,
          status: "fulfilled",
          payload: { orderId: input.orderId },
          idempotencyKey,
        });
        return { externalId: r.id, payload: r };
      },
    );

    await runStep(
      "verify_final_outcome",
      "workflow.verify",
      "read_only",
      async () => ({
        externalId: workflowId,
        payload: { verified: true, paymentId },
      }),
    );

    const wf = await repos.workflows.getWorkflow({ db }, workflowId);
    await repos.workflows.updateWorkflowState(
      { db },
      workflowId,
      "verified",
      wf?.version ?? workflowVersion,
    );

    return {
      workflowId,
      orderId: input.orderId,
      completed: true,
      paymentId,
      steps,
    };
  } finally {
    await platformSql.end({ timeout: 5 });
    await pSql.end({ timeout: 5 });
  }
}

export async function recoverPaymentCrash(args: {
  workflowId: string;
  operationId: string;
  idempotencyKey: string;
  principalId: string;
  workerId: string;
}): Promise<{
  paymentCount: number;
  paymentId: string;
  decision: string;
  receiptId: string;
  classification: string;
}> {
  const { db, sql: platformSql } = createDb();
  const pSql = createSql();
  try {
    // Steal/renew lease with new fencing token after crash
    const lease = await services.acquireLease(
      { db },
      args.workflowId,
      args.workerId,
      120_000,
    );

    const grant = await services.issueGrant(
      { db },
      {
        principalId: args.principalId,
        workflowId: args.workflowId,
        scope: "payment.reconcile",
        kind: "recovery",
        ttlMs: 60_000,
      },
    );
    await services.authorizeRecovery(
      { db },
      {
        principalId: args.principalId,
        workflowId: args.workflowId,
        scope: "payment.reconcile",
        grantId: grant.grantId,
      },
    );

    const found = await paymentProvider.reconcilePayment(pSql, {
      idempotencyKey: args.idempotencyKey,
    });

    const recon = await services.persistReconciliation(
      { db },
      {
        workflowId: args.workflowId,
        operationId: args.operationId,
        localState: "unknown",
        observation: {
          found: found.length > 0,
          status: found[0]?.status,
          externalId: found[0]?.id,
          raw: found[0],
        },
      },
    );

    if (recon.classification !== "confirmed_success" || !found[0]) {
      throw new Error(
        `recovery failed: classification=${recon.classification} count=${found.length}`,
      );
    }

    const receiptId = `rcpt_recovered_${randomUUID()}`;
    await services.persistExternalReceipt(
      { db },
      {
        receiptId,
        provider: "payment",
        externalId: found[0].id,
        idempotencyKey: args.idempotencyKey,
        payload: found[0],
      },
    );

    const entries = await db
      .select()
      .from(effectLedgerEntries)
      .where(eq(effectLedgerEntries.operationId, args.operationId))
      .orderBy(desc(effectLedgerEntries.createdAt))
      .limit(1);

    if (entries[0]) {
      await services.markConfirmedSuccess(
        { db },
        {
          ledgerEntryId: entries[0].id,
          workflowId: args.workflowId,
          workerId: args.workerId,
          fencingToken: lease.fencingToken,
          externalReceiptId: receiptId,
          responsePayload: found[0],
        },
      );
    }

    const wf = await repos.workflows.getWorkflow({ db }, args.workflowId);
    if (wf) {
      await repos.workflows.updateWorkflowState(
        { db },
        args.workflowId,
        "effect_observed",
        wf.version,
      );
    }

    const count = await paymentProvider.countPaymentsByKey(
      pSql,
      args.idempotencyKey,
    );

    return {
      paymentCount: count,
      paymentId: found[0].id,
      decision: recon.decision,
      receiptId,
      classification: recon.classification,
    };
  } finally {
    await platformSql.end({ timeout: 5 });
    await pSql.end({ timeout: 5 });
  }
}
