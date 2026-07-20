/**
 * ACP Session Service — session state is NOT workflow state.
 * resume never retries business effects or consumes execution grants.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createDb,
  sessions,
  sessionMessages,
  principals,
  repos,
} from "@rar/db";

export interface AcpInitializeResult {
  protocolVersion: "1.0";
  serverName: "recoverable-agent-runtime";
  capabilities: { sessions: true; workflows: false };
}

export function acpInitialize(): AcpInitializeResult {
  return {
    protocolVersion: "1.0",
    serverName: "recoverable-agent-runtime",
    capabilities: { sessions: true, workflows: false },
  };
}

export async function sessionNew(args: {
  principalId: string;
  workflowId?: string;
}): Promise<{ sessionId: string; status: string }> {
  const { db, sql } = createDb();
  try {
    await db
      .insert(principals)
      .values({
        id: args.principalId,
        displayName: args.principalId,
        kind: "human",
      })
      .onConflictDoNothing();

    const sessionId = `sess_${randomUUID()}`;
    if (args.workflowId && sessionId === args.workflowId) {
      throw new Error("sessionId must not equal workflowId");
    }

    await db.insert(sessions).values({
      id: sessionId,
      principalId: args.principalId,
      status: "open",
      workflowId: args.workflowId ?? null,
      version: 0,
    });
    return { sessionId, status: "open" };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function sessionResume(args: {
  sessionId: string;
}): Promise<{
  sessionId: string;
  status: string;
  workflowId: string | null;
  grantsConsumed: false;
  effectsRetried: false;
}> {
  const { db, sql } = createDb();
  try {
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, args.sessionId))
      .limit(1);
    const session = rows[0];
    if (!session) {
      throw new Error(`session not found: ${args.sessionId}`);
    }

    // Resume only restores session control context.
    // Does NOT consume grants or dispatch/retry business effects.
    await db
      .update(sessions)
      .set({ status: "resumed", updatedAt: new Date() })
      .where(eq(sessions.id, args.sessionId));

    return {
      sessionId: session.id,
      status: "resumed",
      workflowId: session.workflowId,
      grantsConsumed: false,
      effectsRetried: false,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function sessionPrompt(args: {
  sessionId: string;
  prompt: string;
}): Promise<{ messageId: string; guidance: string }> {
  const { db, sql } = createDb();
  try {
    const session = await repos.sessions.getSession({ db }, args.sessionId);
    if (!session) throw new Error("session not found");
    const messageId = `msg_${randomUUID()}`;
    await db.insert(sessionMessages).values({
      id: messageId,
      sessionId: args.sessionId,
      role: "user",
      content: args.prompt,
    });
    return {
      messageId,
      guidance:
        "Session recorded prompt. Business effects require explicit grants and worker execution — resume/prompt alone never retries unknown mutations.",
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function sessionCancel(
  sessionId: string,
): Promise<{ status: string }> {
  const { db, sql } = createDb();
  try {
    await db
      .update(sessions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    return { status: "cancelled" };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function sessionClose(
  sessionId: string,
): Promise<{ status: string }> {
  const { db, sql } = createDb();
  try {
    await db
      .update(sessions)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    return { status: "closed" };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
