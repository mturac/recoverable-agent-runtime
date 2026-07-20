export const EVIDENCE_PACKAGE = "@rar/evidence" as const;

export function evidenceHealth(): {
  ok: true;
  package: typeof EVIDENCE_PACKAGE;
} {
  return { ok: true, package: EVIDENCE_PACKAGE };
}

export * from "./packet.js";
