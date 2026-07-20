import { describe, expect, it } from "vitest";
import { buildEvidencePacket, verifyEvidencePacket } from "./packet.js";

describe("evidence packet integrity (REQ-23)", () => {
  const secret = "test-evidence-secret";

  it("builds and verifies a valid chain", () => {
    const packet = buildEvidencePacket({
      workflowId: "wf_1",
      secret,
      entries: [
        { kind: "authorization", payload: { grant: "g1" } },
        { kind: "transition", payload: { to: "effect_unknown" } },
        { kind: "reconciliation", payload: { decision: "continue" } },
        { kind: "receipt", payload: { id: "rcpt_1" } },
        { kind: "verification", payload: { ok: true } },
      ],
    });
    expect(verifyEvidencePacket(packet, secret)).toEqual({ ok: true });
  });

  it("detects tampering", () => {
    const packet = buildEvidencePacket({
      workflowId: "wf_1",
      secret,
      entries: [{ kind: "authorization", payload: { a: 1 } }],
    });
    packet.chain[0]!.payload = { a: 2 };
    expect(verifyEvidencePacket(packet, secret).ok).toBe(false);
  });
});
