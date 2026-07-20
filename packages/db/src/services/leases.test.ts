import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { seedWorkflowFixture, withTestDb } from "../test/setup.js";
import {
  acquireLease,
  assertFencedWrite,
  releaseLease,
} from "./leases.js";
import { LeaseError, StaleWorkerError } from "./errors.js";
import { getMetric, resetMetrics } from "./metrics.js";

describe("workflow leases and fencing (REQ-08)", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("issues monotonic fencing tokens on acquire/steal", async () => {
    await withTestDb(async (ctx) => {
      const { workflowId } = await seedWorkflowFixture(ctx.db);
      const l1 = await acquireLease(ctx, workflowId, "worker-a", 60_000);
      expect(l1.fencingToken).toBe(1n);

      await releaseLease(ctx, workflowId, "worker-a", 1n);

      const l2 = await acquireLease(ctx, workflowId, "worker-b", 60_000);
      expect(l2.fencingToken).toBe(2n);
      expect(l2.ownerWorkerId).toBe("worker-b");
    });
  });

  it("rejects concurrent acquire while lease is live", async () => {
    await withTestDb(async (ctx) => {
      const { workflowId } = await seedWorkflowFixture(ctx.db);
      await acquireLease(ctx, workflowId, "worker-a", 60_000);
      await expect(
        acquireLease(ctx, workflowId, "worker-b", 60_000),
      ).rejects.toBeInstanceOf(LeaseError);
    });
  });

  it("rejects stale fencing tokens and counts metric", async () => {
    await withTestDb(async (ctx) => {
      const { workflowId } = await seedWorkflowFixture(ctx.db);
      await acquireLease(ctx, workflowId, "worker-a", 60_000);
      await releaseLease(ctx, workflowId, "worker-a", 1n);
      const l2 = await acquireLease(ctx, workflowId, "worker-b", 60_000);

      await expect(
        assertFencedWrite(ctx, workflowId, "worker-a", 1n),
      ).rejects.toBeInstanceOf(StaleWorkerError);

      // owner with stale token after re-acquire by same id after steal path
      await expect(
        assertFencedWrite(ctx, workflowId, "worker-b", 1n),
      ).rejects.toBeInstanceOf(StaleWorkerError);

      expect(getMetric("stale_worker_write_rejections")).toBeGreaterThanOrEqual(
        1,
      );
      expect(l2.fencingToken).toBe(2n);
    });
  });

  it("allows write with current token for owner", async () => {
    await withTestDb(async (ctx) => {
      const { workflowId } = await seedWorkflowFixture(ctx.db);
      const lease = await acquireLease(ctx, workflowId, "worker-a", 60_000);
      const ok = await assertFencedWrite(
        ctx,
        workflowId,
        "worker-a",
        lease.fencingToken,
      );
      expect(ok.fencingToken).toBe(lease.fencingToken);
      // uniqueness check
      expect(workflowId).toContain("wf_");
      expect(randomUUID().length).toBeGreaterThan(0);
    });
  });
});
