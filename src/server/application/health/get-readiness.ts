import type { AppContainer } from '@/server/bootstrap/container';
import {
  getServerEnv,
  parseServerEnv,
  readRawServerEnv,
} from '@/server/config/env';

export type ReadinessCheck = {
  readonly name: string;
  readonly status: 'pass' | 'fail';
  readonly detail?: string;
};

export type ReadinessResult = {
  readonly status: 'ready' | 'not_ready';
  readonly checkedAt: string;
  readonly checks: readonly ReadinessCheck[];
};

export async function getReadiness(
  container: AppContainer,
): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];

  try {
    parseServerEnv(readRawServerEnv());
    checks.push({ name: 'configuration', status: 'pass' });
  } catch (error) {
    checks.push({
      name: 'configuration',
      status: 'fail',
      detail: error instanceof Error ? error.message : 'invalid configuration',
    });
  }

  const dbResult = await container.checkDatabase(2000);
  checks.push(
    dbResult.ok
      ? { name: 'postgresql', status: 'pass' }
      : {
          name: 'postgresql',
          status: 'fail',
          detail: dbResult.error,
        },
  );

  // Arc RPC is optional until the payment verification phase.
  try {
    const env = getServerEnv();
    const configured =
      env.ARC_RPC_URL !== undefined && env.ARC_RPC_URL.length > 0;
    checks.push({
      name: 'arc_rpc_configured',
      status: 'pass',
      detail: configured
        ? 'configured'
        : 'not required for backend foundation readiness',
    });
  } catch {
    checks.push({
      name: 'arc_rpc_configured',
      status: 'pass',
      detail: 'not required for backend foundation readiness',
    });
  }

  // Foundation: Arc is not a hard readiness dependency until payment phase.
  const criticalFailed = checks.some(
    (check) =>
      (check.name === 'configuration' || check.name === 'postgresql') &&
      check.status === 'fail',
  );

  return {
    status: criticalFailed ? 'not_ready' : 'ready',
    checkedAt: new Date().toISOString(),
    checks,
  };
}
