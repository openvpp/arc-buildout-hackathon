export type HealthResult = {
  readonly status: 'ok';
  readonly service: string;
  readonly checkedAt: string;
};

export function getHealth(): HealthResult {
  return {
    status: 'ok',
    service: 'ev-telemetry-backend',
    checkedAt: new Date().toISOString(),
  };
}
