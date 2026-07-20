/** Lightweight in-process metric counters (OTEL wiring lands later). */

export type MetricName =
  | "stale_worker_write_rejections"
  | "workflow_recoveries"
  | "unknown_effects"
  | "duplicate_attempts_prevented"
  | "compensation_attempts"
  | "manual_review_transitions"
  | "reconciliation_outcomes"
  | "confirmed_without_receipt_rejected";

const counters = new Map<MetricName, number>();

export function incrementMetric(name: MetricName, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function getMetric(name: MetricName): number {
  return counters.get(name) ?? 0;
}

export function resetMetrics(): void {
  counters.clear();
}
