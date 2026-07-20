import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(connectionString?: string): {
  db: Db;
  sql: ReturnType<typeof postgres>;
} {
  const url =
    connectionString ??
    process.env.DATABASE_URL ??
    "postgres://rar:rar@localhost:5432/rar";
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}
