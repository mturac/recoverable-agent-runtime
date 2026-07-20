export const ACP_PACKAGE = "@rar/acp" as const;

export function acpHealth(): { ok: true; package: typeof ACP_PACKAGE } {
  return { ok: true, package: ACP_PACKAGE };
}

export * from "./session-service.js";
