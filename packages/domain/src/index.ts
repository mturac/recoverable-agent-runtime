export const DOMAIN_PACKAGE = "@rar/domain" as const;

export function domainHealth(): { ok: true; package: typeof DOMAIN_PACKAGE } {
  return { ok: true, package: DOMAIN_PACKAGE };
}

export * from "./ids.js";
export * from "./recovery-states.js";
export * from "./effects.js";
export * from "./idempotency.js";
export * from "./recovery-contract.js";
