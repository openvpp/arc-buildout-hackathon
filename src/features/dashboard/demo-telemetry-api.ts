/**
 * Compatibility shim — prefer `@/features/dashboard/owner-telemetry-api`.
 * Demo BFF routes remain at `/api/v1/demo/telemetry/*`.
 */
export {
  createDemoTelemetryApi,
  createOwnerTelemetryApi,
  type DemoTelemetryResponse,
  type DemoVerifyResponse,
  type OwnerTelemetryResponse,
  type OwnerVerifyResponse,
} from './owner-telemetry-api';
