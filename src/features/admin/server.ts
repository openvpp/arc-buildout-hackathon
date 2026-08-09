/**
 * Server-only admin loaders. Import from `@/features/admin/server`
 * in Server Components — never from the client-safe `@/features/admin` barrel.
 */
export {
  isAdminConfigured,
  requireAdminSession,
  sanitizeAdminNextPath,
  ADMIN_PAYMENTS_LIMIT,
} from './admin-auth';
export { loadAdminSnapshot } from './load-snapshot';
export { loadAdminDeviceDetail } from './load-device-detail';
