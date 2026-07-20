import { eq } from "drizzle-orm";
import type { RepoContext } from "./types.js";
import { workflows } from "../schema/platform.js";

export async function getWorkflow(ctx: RepoContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertWorkflow(
  ctx: RepoContext,
  row: typeof workflows.$inferInsert,
) {
  const inserted = await ctx.db.insert(workflows).values(row).returning();
  return inserted[0];
}

export async function updateWorkflowState(
  ctx: RepoContext,
  id: string,
  recoveryState: string,
  expectedVersion: number,
): Promise<{ ok: true; version: number } | { ok: false; reason: "version_mismatch" | "not_found" }> {
  const current = await getWorkflow(ctx, id);
  if (!current) {
    return { ok: false, reason: "not_found" };
  }
  if (current.version !== expectedVersion) {
    return { ok: false, reason: "version_mismatch" };
  }
  const nextVersion = expectedVersion + 1;
  await ctx.db
    .update(workflows)
    .set({
      recoveryState,
      version: nextVersion,
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id));
  return { ok: true, version: nextVersion };
}
