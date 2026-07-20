import { createDb } from "./client.js";
import { principals } from "./schema/platform.js";

async function main(): Promise<void> {
  const { db, sql } = createDb();
  await db
    .insert(principals)
    .values({
      id: "principal_demo_human",
      displayName: "Demo Operator",
      kind: "human",
    })
    .onConflictDoNothing();
  await db
    .insert(principals)
    .values({
      id: "principal_worker_service",
      displayName: "Worker Service",
      kind: "service",
    })
    .onConflictDoNothing();
  await sql.end({ timeout: 5 });
  console.log("[@rar/db] seed complete");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
