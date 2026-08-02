import { getServerEnv } from '@/server/config/env';
import { formatAtomicAmount } from '@/server/domain/shared/money';
import type { TelemetryPricingPolicy } from '@/server/domain/shared/ports';

export function createConfiguredPricingPolicy(): TelemetryPricingPolicy {
  return {
    async getPrice() {
      const env = getServerEnv();
      const amountAtomic = env.TELEMETRY_PRICE_USDC_ATOMIC;
      const decimals = 6;

      return {
        amountAtomic,
        amountDisplay: formatAtomicAmount(amountAtomic, decimals),
        decimals,
        asset: 'USDC',
        pricingVersion: 'v1',
      };
    },
  };
}
