import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  acpInitialize,
  sessionCancel,
  sessionClose,
  sessionNew,
  sessionPrompt,
  sessionResume,
} from "@rar/acp";
import { createDb, repos, workflows, sessions, workflowLeases, effectLedgerEntries, operations } from "@rar/db";
import { buildEvidencePacket, verifyEvidencePacket } from "@rar/evidence";
import { domainHealth } from "@rar/domain";
import { eq } from "drizzle-orm";

const port = Number(process.env.API_PORT ?? 8080);
const host = process.env.API_HOST ?? "0.0.0.0";
const bearer = process.env.API_BEARER_TOKEN ?? "dev-api-token-change-me";

function redact(obj: unknown): unknown {
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (/secret|password|token|authorization/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return obj;
}

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${bearer}`) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "api",
    domain: domainHealth(),
  }));

  // ACP JSON-RPC
  app.post("/acp/jsonrpc", async (req, reply) => {
    const body = req.body as {
      jsonrpc?: string;
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
    };
    const id = body.id ?? null;
    const method = body.method ?? "";
    const params = body.params ?? {};

    try {
      let result: unknown;
      switch (method) {
        case "initialize":
          result = acpInitialize();
          break;
        case "session/new":
          result = await sessionNew({
            principalId: String(params.principalId ?? "principal_demo_human"),
            workflowId: params.workflowId
              ? String(params.workflowId)
              : undefined,
          });
          break;
        case "session/resume":
          result = await sessionResume({
            sessionId: String(params.sessionId),
          });
          break;
        case "session/prompt":
          result = await sessionPrompt({
            sessionId: String(params.sessionId),
            prompt: String(params.prompt ?? ""),
          });
          break;
        case "session/cancel":
          result = await sessionCancel(String(params.sessionId));
          break;
        case "session/close":
          result = await sessionClose(String(params.sessionId));
          break;
        default:
          return reply.code(400).send({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
      }
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return reply.code(500).send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : "error",
        },
      });
    }
  });

  // Ops REST for dashboard
  app.get("/ops/sessions", async () => {
    const { db, sql } = createDb();
    try {
      return await db.select().from(sessions);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  app.get("/ops/workflows", async () => {
    const { db, sql } = createDb();
    try {
      return await db.select().from(workflows);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  app.get<{ Params: { id: string } }>("/ops/workflows/:id", async (req) => {
    const { db, sql } = createDb();
    try {
      const wf = await repos.workflows.getWorkflow({ db }, req.params.id);
      const leaseRows = await db
        .select()
        .from(workflowLeases)
        .where(eq(workflowLeases.workflowId, req.params.id));
      const ops = await db
        .select()
        .from(operations)
        .where(eq(operations.workflowId, req.params.id));
      const ledger = await db
        .select()
        .from(effectLedgerEntries)
        .where(eq(effectLedgerEntries.workflowId, req.params.id));
      return redact({ workflow: wf, lease: leaseRows[0] ?? null, operations: ops, ledger });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/ops/workflows/:id/evidence",
    async (req) => {
      const secret =
        process.env.EVIDENCE_HMAC_SECRET ??
        "dev-evidence-hmac-secret-change-me-32b";
      const packet = buildEvidencePacket({
        workflowId: req.params.id,
        secret,
        entries: [
          { kind: "export", payload: { workflowId: req.params.id } },
          { kind: "verification", payload: { exportedAt: new Date().toISOString() } },
        ],
      });
      const v = verifyEvidencePacket(packet, secret);
      return { packet, verified: v.ok };
    },
  );

  await app.listen({ port, host });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
