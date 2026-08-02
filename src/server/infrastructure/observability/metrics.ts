/**
 * Lightweight metrics foundation.
 *
 * High-cardinality labels (wallet/device IDs) must never be used as metric
 * labels — put those in logs/traces instead. A real OTLP exporter can replace
 * this sink later.
 */

export type MetricLabels = Readonly<Record<string, string>>;

export type MetricsSink = {
  increment(name: string, value?: number, labels?: MetricLabels): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
  gauge(name: string, value: number, labels?: MetricLabels): void;
};

const counters = new Map<string, number>();

export const inProcessMetricsSink: MetricsSink = {
  increment(name, value = 1) {
    counters.set(name, (counters.get(name) ?? 0) + value);
  },
  observe() {
    // Histogram export deferred; values are accepted for API stability.
  },
  gauge(name, value) {
    counters.set(name, value);
  },
};

let sink: MetricsSink = inProcessMetricsSink;

export function setMetricsSink(next: MetricsSink): void {
  sink = next;
}

export function metrics(): MetricsSink {
  return sink;
}

/** Test helper */
export function resetMetricsForTests(): void {
  counters.clear();
  sink = inProcessMetricsSink;
}
