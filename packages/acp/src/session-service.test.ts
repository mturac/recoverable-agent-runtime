import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  acpInitialize,
  sessionNew,
  sessionPrompt,
  sessionResume,
  sessionClose,
} from "./session-service.js";
import { createDb, services } from "@rar/db";

describe("ACP session service (REQ-04, REQ-05, REQ-32)", () => {
  it("initialize returns capabilities", () => {
    const init = acpInitialize();
    expect(init.protocolVersion).toBe("1.0");
    expect(init.capabilities.sessions).toBe(true);
  });

  it("resume does not consume grants or retry effects", async () => {
    const principalId = `principal_${randomUUID()}`;
    const created = await sessionNew({ principalId });
    expect(created.sessionId.startsWith("sess_")).toBe(true);

    const { db, sql } = createDb();
    try {
      await db
        .insert((await import("@rar/db")).principals)
        .values({ id: principalId, displayName: "p", kind: "human" })
        .onConflictDoNothing();
      const grant = await services.issueGrant(
        { db },
        {
          principalId,
          sessionId: created.sessionId,
          scope: "payment.capture",
          kind: "execution",
          ttlMs: 60_000,
        },
      );
      const before = await services.peekGrant({ db }, grant.grantId);
      expect(before?.consumedAt).toBeNull();

      const resumed = await sessionResume({ sessionId: created.sessionId });
      expect(resumed.grantsConsumed).toBe(false);
      expect(resumed.effectsRetried).toBe(false);

      const after = await services.peekGrant({ db }, grant.grantId);
      expect(after?.consumedAt).toBeNull();
    } finally {
      await sql.end({ timeout: 5 });
    }

    await sessionPrompt({
      sessionId: created.sessionId,
      prompt: "continue order",
    });
    await sessionClose(created.sessionId);
  }, 30_000);

  it("concurrent resume is safe", async () => {
    const principalId = `principal_${randomUUID()}`;
    const created = await sessionNew({ principalId });
    const results = await Promise.all([
      sessionResume({ sessionId: created.sessionId }),
      sessionResume({ sessionId: created.sessionId }),
    ]);
    expect(results.every((r) => r.effectsRetried === false)).toBe(true);
    expect(results.every((r) => r.grantsConsumed === false)).toBe(true);
  }, 30_000);
});
