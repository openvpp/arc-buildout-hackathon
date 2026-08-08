/**
 * Client-safe dashboard feature surface.
 * Server Component loaders stay out of this barrel so layouts/client panels
 * can import without pulling `server-only` (load-snapshot / load-device-detail).
 */
export { DashboardSessionBridge } from './dashboard-session-bridge';
export {
  createDemoTelemetryApi,
  type DemoTelemetryResponse,
  type DemoVerifyResponse,
} from './demo-telemetry-api';
export { RequestTelemetryPanel } from './request-telemetry-panel';
export { VerifyTelemetryButton } from './verify-telemetry-button';
