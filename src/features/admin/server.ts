/**
 * Server-only admin loaders. Import from `@/features/admin/server`
 * in Server Components — never from the client-safe `@/features/admin` barrel.
 */
export { loadAdminSnapshot } from './load-snapshot';
export { loadAdminDeviceDetail } from './load-device-detail';
