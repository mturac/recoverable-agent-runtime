import { createHash, createHmac, randomUUID } from "node:crypto";

export interface EvidenceLink {
  seq: number;
  kind: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export interface EvidencePacket {
  id: string;
  workflowId: string;
  createdAt: string;
  chain: EvidenceLink[];
  chainHeadHash: string;
  hmacSignature: string;
}

function hashLink(
  seq: number,
  kind: string,
  payload: unknown,
  prevHash: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ seq, kind, payload, prevHash }))
    .digest("hex");
}

export function buildEvidencePacket(args: {
  workflowId: string;
  secret: string;
  entries: Array<{ kind: string; payload: unknown }>;
}): EvidencePacket {
  const chain: EvidenceLink[] = [];
  let prev = "genesis";
  args.entries.forEach((e, i) => {
    const seq = i + 1;
    const hash = hashLink(seq, e.kind, e.payload, prev);
    chain.push({
      seq,
      kind: e.kind,
      payload: e.payload,
      prevHash: prev,
      hash,
    });
    prev = hash;
  });
  const chainHeadHash = prev;
  const hmacSignature = createHmac("sha256", args.secret)
    .update(chainHeadHash)
    .digest("hex");
  return {
    id: `evp_${randomUUID()}`,
    workflowId: args.workflowId,
    createdAt: new Date().toISOString(),
    chain,
    chainHeadHash,
    hmacSignature,
  };
}

export function verifyEvidencePacket(
  packet: EvidencePacket,
  secret: string,
): { ok: true } | { ok: false; reason: string } {
  let prev = "genesis";
  for (const link of packet.chain) {
    if (link.prevHash !== prev) {
      return { ok: false, reason: `prevHash break at seq ${link.seq}` };
    }
    const expected = hashLink(link.seq, link.kind, link.payload, prev);
    if (expected !== link.hash) {
      return { ok: false, reason: `hash mismatch at seq ${link.seq}` };
    }
    prev = link.hash;
  }
  if (prev !== packet.chainHeadHash) {
    return { ok: false, reason: "chainHeadHash mismatch" };
  }
  const sig = createHmac("sha256", secret)
    .update(packet.chainHeadHash)
    .digest("hex");
  if (sig !== packet.hmacSignature) {
    return { ok: false, reason: "hmac invalid" };
  }
  return { ok: true };
}
