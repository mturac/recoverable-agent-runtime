import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { seedWorkflowFixture, withTestDb } from "../test/setup.js";
import {
  authorizeRecovery,
  consumeGrant,
  GrantError,
  issueGrant,
  peekGrant,
} from "./control-plane.js";
import { actionGrants } from "../schema/platform.js";

describe("control plane grants and policy (REQ-06, REQ-07)", () => {
  it("issues and consumes an execution grant once", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const issued = await issueGrant(ctx, {
        principalId: fx.principalId,
        workflowId: fx.workflowId,
        scope: "payment.capture",
        kind: "execution",
        ttlMs: 60_000,
      });
      expect(issued.grantId).toMatch(/^grant_/);

      await consumeGrant(ctx, {
        grantId: issued.grantId,
        principalId: fx.principalId,
        expectedKind: "execution",
        scope: "payment.capture",
      });

      await expect(
        consumeGrant(ctx, {
          grantId: issued.grantId,
          principalId: fx.principalId,
          expectedKind: "execution",
          scope: "payment.capture",
        }),
      ).rejects.toMatchObject({ code: "CONSUMED" } satisfies Partial<GrantError>);
    });
  });

  it("rejects expired authorization", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const issued = await issueGrant(ctx, {
        principalId: fx.principalId,
        workflowId: fx.workflowId,
        scope: "payment.capture",
        kind: "execution",
        ttlMs: 1,
        now: new Date(Date.now() - 10_000),
      });
      await expect(
        consumeGrant(ctx, {
          grantId: issued.grantId,
          principalId: fx.principalId,
          expectedKind: "execution",
        }),
      ).rejects.toMatchObject({ code: "EXPIRED" });
    });
  });

  it("peek does not consume (session resume safe)", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const issued = await issueGrant(ctx, {
        principalId: fx.principalId,
        scope: "payment.capture",
        kind: "execution",
        ttlMs: 60_000,
      });
      const peeked = await peekGrant(ctx, issued.grantId);
      expect(peeked?.consumedAt).toBeNull();
      const again = await peekGrant(ctx, issued.grantId);
      expect(again?.consumedAt).toBeNull();
      const rows = await ctx.db
        .select()
        .from(actionGrants)
        .where(eq(actionGrants.id, issued.grantId));
      expect(rows[0]?.consumedAt).toBeNull();
    });
  });

  it("recovery authorization requires recovery grant kind", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const exec = await issueGrant(ctx, {
        principalId: fx.principalId,
        workflowId: fx.workflowId,
        scope: "payment.reconcile",
        kind: "execution",
        ttlMs: 60_000,
      });
      await expect(
        authorizeRecovery(ctx, {
          principalId: fx.principalId,
          workflowId: fx.workflowId,
          scope: "payment.reconcile",
          grantId: exec.grantId,
        }),
      ).rejects.toMatchObject({ code: "WRONG_KIND" });

      const recovery = await issueGrant(ctx, {
        principalId: fx.principalId,
        workflowId: fx.workflowId,
        scope: "payment.reconcile",
        kind: "recovery",
        ttlMs: 60_000,
      });
      const ok = await authorizeRecovery(ctx, {
        principalId: fx.principalId,
        workflowId: fx.workflowId,
        scope: "payment.reconcile",
        grantId: recovery.grantId,
      });
      expect(ok.policyDecisionId).toMatch(/^pol_/);
    });
  });

  it("rejects non-owner recovery", async () => {
    await withTestDb(async (ctx) => {
      const fx = await seedWorkflowFixture(ctx.db);
      const other = `principal_${randomUUID()}`;
      await ctx.db.insert(
        (await import("../schema/platform.js")).principals,
      ).values({
        id: other,
        displayName: "Other",
        kind: "human",
      });
      const recovery = await issueGrant(ctx, {
        principalId: other,
        workflowId: fx.workflowId,
        scope: "payment.reconcile",
        kind: "recovery",
        ttlMs: 60_000,
      });
      await expect(
        authorizeRecovery(ctx, {
          principalId: other,
          workflowId: fx.workflowId,
          scope: "payment.reconcile",
          grantId: recovery.grantId,
        }),
      ).rejects.toMatchObject({ code: "NOT_OWNER" });
    });
  });
});
