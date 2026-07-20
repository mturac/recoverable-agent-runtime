import { eq } from "drizzle-orm";
import type { RepoContext } from "./types.js";
import { sessions } from "../schema/platform.js";

export async function getSession(ctx: RepoContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertSession(
  ctx: RepoContext,
  row: typeof sessions.$inferInsert,
) {
  const inserted = await ctx.db.insert(sessions).values(row).returning();
  return inserted[0];
}
