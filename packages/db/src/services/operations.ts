import { and, eq } from "drizzle-orm";
import type { RepoContext } from "../repos/types.js";
import { operations, operationAttempts } from "../schema/platform.js";
import { OccConflictError } from "./errors.js";
import { assertFencedWrite } from "./leases.js";

export async function insertOperation(
  ctx: RepoContext,
  row: typeof operations.$inferInsert,
) {
  const inserted = await ctx.db.insert(operations).values(row).returning();
  return inserted[0]!;
}

export async function getOperation(ctx: RepoContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(operations)
    .where(eq(operations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateOperationStateFenced(
  ctx: RepoContext,
  args: {
    operationId: string;
    workflowId: string;
    workerId: string;
    fencingToken: bigint;
    recoveryState: string;
    expectedVersion: number;
  },
): Promise<{ version: number }> {
  await assertFencedWrite(
    ctx,
    args.workflowId,
    args.workerId,
    args.fencingToken,
  );

  const current = await getOperation(ctx, args.operationId);
  if (!current) {
    throw new OccConflictError(`operation ${args.operationId} not found`);
  }
  if (current.version !== args.expectedVersion) {
    throw new OccConflictError(
      `operation version mismatch: expected ${args.expectedVersion}, actual ${current.version}`,
    );
  }

  const nextVersion = args.expectedVersion + 1;
  const updated = await ctx.db
    .update(operations)
    .set({
      recoveryState: args.recoveryState,
      version: nextVersion,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operations.id, args.operationId),
        eq(operations.version, args.expectedVersion),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new OccConflictError("operation concurrent update lost");
  }
  return { version: nextVersion };
}

export async function insertAttempt(
  ctx: RepoContext,
  row: typeof operationAttempts.$inferInsert,
) {
  const inserted = await ctx.db
    .insert(operationAttempts)
    .values(row)
    .returning();
  return inserted[0]!;
}
