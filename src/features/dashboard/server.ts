/**
 * Server-only dashboard loaders. Import from `@/features/dashboard/server`
 * in Server Components — never from the client-safe `@/features/dashboard`
 * barrel (that would pull `server-only` into client layouts/panels).
 */
export { loadDashboardSnapshot } from './load-snapshot';
export { loadDeviceDetail } from './load-device-detail';
