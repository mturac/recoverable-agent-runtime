import { createHash } from "node:crypto";

export function fingerprint(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
