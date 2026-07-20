import { describe, expect, it } from "vitest";
import {
  asSessionId,
  asWorkflowId,
  assertDistinctSessionAndWorkflow,
  IdentityError,
} from "./ids.js";

describe("identity separation (REQ-03)", () => {
  it("accepts distinct session and workflow ids", () => {
    const sessionId = asSessionId("sess_1");
    const workflowId = asWorkflowId("wf_1");
    expect(() =>
      assertDistinctSessionAndWorkflow(sessionId, workflowId),
    ).not.toThrow();
  });

  it("rejects sessionId used as workflowId", () => {
    const sessionId = asSessionId("same");
    const workflowId = asWorkflowId("same");
    expect(() =>
      assertDistinctSessionAndWorkflow(sessionId, workflowId),
    ).toThrow(IdentityError);
  });

  it("rejects empty ids", () => {
    expect(() => asSessionId("  ")).toThrow(IdentityError);
  });
});
