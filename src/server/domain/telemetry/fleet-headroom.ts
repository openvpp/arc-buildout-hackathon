/**
 * Domain re-export — prefer `@/lib/telemetry/fleet-headroom` for shared/UI use.
 */
export {
  computeChargeHeadroom,
  sumChargeHeadroomKilowattHours,
  type ChargeHeadroomInput,
  type ChargeHeadroomResult,
} from '@/lib/telemetry/fleet-headroom';
