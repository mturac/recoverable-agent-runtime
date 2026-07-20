export const DB_PACKAGE = "@rar/db" as const;

export function dbHealth(): { ok: true; package: typeof DB_PACKAGE } {
  return { ok: true, package: DB_PACKAGE };
}

export * from "./client.js";
export * from "./schema/index.js";
export * as repos from "./repos/index.js";
export * as services from "./services/index.js";
export type { Db } from "./client.js";

