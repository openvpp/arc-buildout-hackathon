/**
 * Client-safe admin feature surface.
 * Server Component loaders stay out of this barrel so login/logout client
 * components can import without pulling `server-only`.
 */
export { AdminLogoutButton } from './logout-button';
export { AdminLoginForm } from './login-form';
export { loginAdmin, type AdminLoginState } from './login-action';
export { AdminShell } from './admin-shell';
export { AdminSidebarNav } from './admin-sidebar-nav';
export { ADMIN_NAV, type AdminNavItem } from './admin-nav';
export { AdminUnavailableState } from './admin-unavailable-state';
export {
  AdminHomeMetricCard,
  type AdminHomeTone,
} from './admin-home-metric-card';
export {
  agentVerificationBadge,
  headroomUnavailableLabel,
  paymentStatusBadge,
} from './admin-display';
export {
  summarizeFleetFlexibility,
  formatKilowattHours,
  type FleetFlexibilitySummary,
  type FleetFlexibilityVehicle,
} from './fleet-flexibility';
