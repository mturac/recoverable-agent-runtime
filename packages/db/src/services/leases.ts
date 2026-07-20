import { eq } from "drizzle-orm";
import type { RepoContext } from "../repos/types.js";
import { workflowLeases } from "../schema/platform.js";
import { LeaseError, StaleWorkerError } from "./errors.js";
import { incrementMetric } from "./metrics.js";

export interface LeaseRecord {
  workflowId: string;
  ownerWorkerId: string;
  fencingToken: bigint;
  expiresAt: Date;
}

const DEFAULT_TTL_MS = 30_000;

export async function getLease(
  ctx: RepoContext,
  workflowId: string,
): Promise<LeaseRecord | null> {
  const rows = await ctx.db
    .select()
    .from(workflowLeases)
    .where(eq(workflowLeases.workflowId, workflowId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    workflowId: row.workflowId,
    ownerWorkerId: row.ownerWorkerId,
    fencingToken: row.fencingToken,
    expiresAt: row.expiresAt,
  };
}

/**
 * Acquire or steal an expired lease. Always issues a monotonic fencing token
 * (previous + 1, or 1 if none).
 */
export async function acquireLease(
  ctx: RepoContext,
  workflowId: string,
  workerId: string,
  ttlMs = DEFAULT_TTL_MS,
  now = new Date(),
): Promise<LeaseRecord> {
  const existing = await getLease(ctx, workflowId);
  const expiresAt = new Date(now.getTime() + ttlMs);

  if (!existing) {
    const fencingToken = 1n;
    await ctx.db.insert(workflowLeases).values({
      workflowId,
      ownerWorkerId: workerId,
      fencingToken,
      expiresAt,
      updatedAt: now,
    });
    return { workflowId, ownerWorkerId: workerId, fencingToken, expiresAt };
  }

  if (existing.ownerWorkerId !== workerId && existing.expiresAt > now) {
    throw new LeaseError(
      `workflow ${workflowId} leased by ${existing.ownerWorkerId} until ${existing.expiresAt.toISOString()}`,
    );
  }

  const fencingToken = existing.fencingToken + 1n;
  await ctx.db
    .update(workflowLeases)
    .set({
      ownerWorkerId: workerId,
      fencingToken,
      expiresAt,
      updatedAt: now,
    })
    .where(eq(workflowLeases.workflowId, workflowId));

  return { workflowId, ownerWorkerId: workerId, fencingToken, expiresAt };
}

/**
 * Fail-closed fencing check. Presented token must equal the current lease
 * token and the lease must be owned by the worker and unexpired.
 */
export async function assertFencedWrite(
  ctx: RepoContext,
  workflowId: string,
  workerId: string,
  presentedToken: bigint,
  now = new Date(),
): Promise<LeaseRecord> {
  const lease = await getLease(ctx, workflowId);
  if (!lease) {
    throw new LeaseError(`no lease for workflow ${workflowId}`);
  }
  if (lease.expiresAt <= now) {
    throw new LeaseError(`lease expired for workflow ${workflowId}`);
  }
  if (lease.ownerWorkerId !== workerId) {
    incrementMetric("stale_worker_write_rejections");
    throw new StaleWorkerError(
      `worker ${workerId} is not lease owner`,
      presentedToken,
      lease.fencingToken,
    );
  }
  if (presentedToken < lease.fencingToken) {
    incrementMetric("stale_worker_write_rejections");
    throw new StaleWorkerError(
      `stale fencing token ${presentedToken} < ${lease.fencingToken}`,
      presentedToken,
      lease.fencingToken,
    );
  }
  if (presentedToken > lease.fencingToken) {
    throw new LeaseError(
      `unknown future fencing token ${presentedToken} > ${lease.fencingToken}`,
    );
  }
  return lease;
}

export async function releaseLease(
  ctx: RepoContext,
  workflowId: string,
  workerId: string,
  presentedToken: bigint,
): Promise<void> {
  await assertFencedWrite(ctx, workflowId, workerId, presentedToken);
  // Expire immediately rather than delete — preserves token monotonicity history.
  await ctx.db
    .update(workflowLeases)
    .set({
      expiresAt: new Date(0),
      updatedAt: new Date(),
    })
    .where(eq(workflowLeases.workflowId, workflowId));
}
