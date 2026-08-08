/**
 * Client-safe admin feature surface.
 * Server Component loaders stay out of this barrel so login/logout client
 * components can import without pulling `server-only`.
 */
export { AdminLogoutButton } from './logout-button';
export { AdminLoginForm } from './login-form';
export { loginAdmin, type AdminLoginState } from './login-action';
export {
  summarizeFleetFlexibility,
  formatKilowattHours,
  type FleetFlexibilitySummary,
  type FleetFlexibilityVehicle,
} from './fleet-flexibility';
