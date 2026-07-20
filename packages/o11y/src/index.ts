import { metrics, trace, context, SpanStatusCode } from "@opentelemetry/api";

export const O11Y_PACKAGE = "@rar/o11y" as const;

export function o11yHealth(): { ok: true; package: typeof O11Y_PACKAGE } {
  return { ok: true, package: O11Y_PACKAGE };
}

export interface CorrelationIds {
  sessionId?: string;
  workflowId?: string;
  operationId?: string;
  attemptId?: string;
  principalId?: string;
  workerId?: string;
  fencingToken?: string;
  idempotencyKey?: string;
  externalReceiptId?: string;
  policyDecisionId?: string;
}

const meter = metrics.getMeter("rar");
export const recoveryCounter = meter.createCounter("workflow_recoveries");
export const unknownEffectCounter = meter.createCounter("unknown_effects");
export const reconCounter = meter.createCounter("reconciliation_outcomes");
export const duplicatePreventedCounter = meter.createCounter(
  "duplicate_attempts_prevented",
);
export const compensationCounter = meter.createCounter("compensation_attempts");
export const manualReviewCounter = meter.createCounter(
  "manual_review_transitions",
);
export const staleWorkerCounter = meter.createCounter(
  "stale_worker_write_rejections",
);
export const recoveryLatency = meter.createHistogram("recovery_latency_ms");

export function withCorrelationLog(
  level: "info" | "warn" | "error",
  message: string,
  corr: CorrelationIds,
  extra?: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    level,
    message,
    ...corr,
    ...extra,
    ts: new Date().toISOString(),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function startSpan(name: string, corr: CorrelationIds) {
  const tracer = trace.getTracer("rar");
  const span = tracer.startSpan(name);
  for (const [k, v] of Object.entries(corr)) {
    if (v !== undefined) span.setAttribute(k, v);
  }
  return {
    span,
    endOk() {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },
    endErr(err: unknown) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : "error",
      });
      span.end();
    },
    context,
  };
}
