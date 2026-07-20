import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL ?? "postgres://rar:rar@localhost:5432/rar";
  const sql = postgres(url, { max: 1 });

  await sql`CREATE SCHEMA IF NOT EXISTS platform`;
  await sql`
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT NOT NULL,
      success BOOLEAN NOT NULL DEFAULT true
    )
  `;

  const migrationsDir = path.resolve(__dirname, "../migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const body = await readFile(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const applied = await sql<{ id: string }[]>`
      SELECT id FROM platform.schema_migrations WHERE id = ${file}
    `;
    if (applied.length > 0) {
      console.log(`[@rar/db] skip ${file} (already applied)`);
      continue;
    }
    console.log(`[@rar/db] apply ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`
        INSERT INTO platform.schema_migrations (id, checksum, success)
        VALUES (${file}, ${checksum}, true)
      `;
    });
  }

  await sql.end({ timeout: 5 });
  console.log("[@rar/db] migrate complete");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
