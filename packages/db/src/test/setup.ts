import { randomUUID } from "node:crypto";
import { createDb, type Db } from "../client.js";
import {
  principals,
  workflows,
  operations,
} from "../schema/platform.js";
import type { RepoContext } from "../repos/types.js";

export function testDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ?? "postgres://rar:rar@localhost:5432/rar"
  );
}

export async function withTestDb<T>(
  fn: (ctx: RepoContext & { sql: ReturnType<typeof createDb>["sql"] }) => Promise<T>,
): Promise<T> {
  const { db, sql } = createDb(testDatabaseUrl());
  try {
    return await fn({ db, sql });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function seedWorkflowFixture(db: Db): Promise<{
  principalId: string;
  workflowId: string;
  operationId: string;
  idempotencyKey: string;
}> {
  const principalId = `principal_${randomUUID()}`;
  const workflowId = `wf_${randomUUID()}`;
  const operationId = `op_${randomUUID()}`;
  const idempotencyKey = `idem:${workflowId}:${operationId}`;

  await db.insert(principals).values({
    id: principalId,
    displayName: "Test Principal",
    kind: "human",
  });

  await db.insert(workflows).values({
    id: workflowId,
    principalId,
    kind: "order_fulfillment",
    recoveryState: "execution_started",
    version: 0,
  });

  await db.insert(operations).values({
    id: operationId,
    workflowId,
    operationName: "payment.capture",
    recoveryState: "effect_requested",
    version: 0,
    idempotencyKey,
    mutationKind: "compensatable_mutation",
  });

  return { principalId, workflowId, operationId, idempotencyKey };
}
