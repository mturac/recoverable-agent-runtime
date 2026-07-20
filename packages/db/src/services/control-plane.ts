import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { RepoContext } from "../repos/types.js";
import {
  actionGrants,
  policyDecisions,
  workflows,
} from "../schema/platform.js";

export type GrantKind = "execution" | "recovery";

export class GrantError extends Error {
  constructor(
    message: string,
    readonly code:
      | "EXPIRED"
      | "CONSUMED"
      | "NOT_FOUND"
      | "WRONG_KIND"
      | "NOT_OWNER"
      | "DENIED",
  ) {
    super(message);
    this.name = "GrantError";
  }
}

export async function recordPolicyDecision(
  ctx: RepoContext,
  args: {
    principalId?: string;
    grantId?: string;
    decision: "allow" | "deny";
    reason: string;
    policy: string;
  },
): Promise<string> {
  const id = `pol_${randomUUID()}`;
  await ctx.db.insert(policyDecisions).values({
    id,
    principalId: args.principalId ?? null,
    grantId: args.grantId ?? null,
    decision: args.decision,
    reason: args.reason,
    policy: args.policy,
    createdAt: new Date(),
  });
  return id;
}

export async function issueGrant(
  ctx: RepoContext,
  args: {
    principalId: string;
    sessionId?: string;
    workflowId?: string;
    scope: string;
    kind: GrantKind;
    ttlMs: number;
    now?: Date;
  },
): Promise<{ grantId: string; expiresAt: Date; policyDecisionId: string }> {
  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + args.ttlMs);
  const grantId = `grant_${randomUUID()}`;

  await ctx.db.insert(actionGrants).values({
    id: grantId,
    principalId: args.principalId,
    sessionId: args.sessionId ?? null,
    workflowId: args.workflowId ?? null,
    scope: args.scope,
    kind: args.kind,
    expiresAt,
    consumedAt: null,
    createdAt: now,
  });

  const policyDecisionId = await recordPolicyDecision(ctx, {
    principalId: args.principalId,
    grantId,
    decision: "allow",
    reason: `issued ${args.kind} grant for scope ${args.scope}`,
    policy: args.scope,
  });

  return { grantId, expiresAt, policyDecisionId };
}

export async function consumeGrant(
  ctx: RepoContext,
  args: {
    grantId: string;
    principalId: string;
    expectedKind: GrantKind;
    scope?: string;
    now?: Date;
  },
): Promise<{ policyDecisionId: string }> {
  const now = args.now ?? new Date();
  const rows = await ctx.db
    .select()
    .from(actionGrants)
    .where(eq(actionGrants.id, args.grantId))
    .limit(1);
  const grant = rows[0];
  if (!grant) {
    await recordPolicyDecision(ctx, {
      principalId: args.principalId,
      grantId: args.grantId,
      decision: "deny",
      reason: "grant not found",
      policy: args.scope ?? "unknown",
    });
    throw new GrantError("grant not found", "NOT_FOUND");
  }
  if (grant.principalId !== args.principalId) {
    const policyDecisionId = await recordPolicyDecision(ctx, {
      principalId: args.principalId,
      grantId: args.grantId,
      decision: "deny",
      reason: "principal mismatch",
      policy: grant.scope,
    });
    void policyDecisionId;
    throw new GrantError("grant principal mismatch", "DENIED");
  }
  if (grant.kind !== args.expectedKind) {
    await recordPolicyDecision(ctx, {
      principalId: args.principalId,
      grantId: args.grantId,
      decision: "deny",
      reason: `expected kind ${args.expectedKind}, got ${grant.kind}`,
      policy: grant.scope,
    });
    throw new GrantError("wrong grant kind", "WRONG_KIND");
  }
  if (args.scope && grant.scope !== args.scope) {
    await recordPolicyDecision(ctx, {
      principalId: args.principalId,
      grantId: args.grantId,
      decision: "deny",
      reason: `scope mismatch: ${grant.scope} != ${args.scope}`,
      policy: grant.scope,
    });
    throw new GrantError("scope mismatch", "DENIED");
  }
  if (grant.expiresAt <= now) {
    await recordPolicyDecision(ctx, {
      principalId: args.principalId,
      grantId: args.grantId,
      decision: "deny",
      reason: "grant expired",
      policy: grant.scope,
    });
    throw new GrantError("grant expired", "EXPIRED");
  }
  if (grant.consumedAt) {
    await recordPolicyDecision(ctx, {
      principalId: args.principalId,
      grantId: args.grantId,
      decision: "deny",
      reason: "grant already consumed",
      policy: grant.scope,
    });
    throw new GrantError("grant already consumed", "CONSUMED");
  }

  const updated = await ctx.db
    .update(actionGrants)
    .set({ consumedAt: now })
    .where(and(eq(actionGrants.id, args.grantId), isNull(actionGrants.consumedAt)))
    .returning();

  if (updated.length === 0) {
    await recordPolicyDecision(ctx, {
      principalId: args.principalId,
      grantId: args.grantId,
      decision: "deny",
      reason: "grant already consumed (race)",
      policy: grant.scope,
    });
    throw new GrantError("grant already consumed", "CONSUMED");
  }

  const policyDecisionId = await recordPolicyDecision(ctx, {
    principalId: args.principalId,
    grantId: args.grantId,
    decision: "allow",
    reason: "grant consumed",
    policy: grant.scope,
  });
  return { policyDecisionId };
}

/**
 * Session resume must never consume an execution grant (REQ-05 coordination).
 * This helper only peeks; it does not call consumeGrant.
 */
export async function peekGrant(
  ctx: RepoContext,
  grantId: string,
): Promise<(typeof actionGrants.$inferSelect) | null> {
  const rows = await ctx.db
    .select()
    .from(actionGrants)
    .where(eq(actionGrants.id, grantId))
    .limit(1);
  return rows[0] ?? null;
}

export async function assertWorkflowOwner(
  ctx: RepoContext,
  workflowId: string,
  principalId: string,
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);
  const wf = rows[0];
  if (!wf) {
    throw new GrantError("workflow not found", "NOT_FOUND");
  }
  if (wf.principalId !== principalId) {
    await recordPolicyDecision(ctx, {
      principalId,
      decision: "deny",
      reason: "workflow ownership mismatch",
      policy: "workflow.ownership",
    });
    throw new GrantError("not workflow owner", "NOT_OWNER");
  }
}

export async function authorizeRecovery(
  ctx: RepoContext,
  args: {
    principalId: string;
    workflowId: string;
    scope: string;
    grantId: string;
    now?: Date;
  },
): Promise<{ policyDecisionId: string }> {
  await assertWorkflowOwner(ctx, args.workflowId, args.principalId);
  return consumeGrant(ctx, {
    grantId: args.grantId,
    principalId: args.principalId,
    expectedKind: "recovery",
    scope: args.scope,
    now: args.now,
  });
}
