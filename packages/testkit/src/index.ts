export const TESTKIT_PACKAGE = "@rar/testkit" as const;

export function testkitHealth(): { ok: true; package: typeof TESTKIT_PACKAGE } {
  return { ok: true, package: TESTKIT_PACKAGE };
}

export * from "./failure-injection.js";
