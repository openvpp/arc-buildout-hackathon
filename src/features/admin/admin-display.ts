import type { FleetFlexibilityVehicle } from './fleet-flexibility';

export function agentVerificationBadge(status: string | undefined): {
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  label: string;
} {
  if (status === undefined) {
    return { tone: 'neutral', label: 'Not verified' };
  }
  if (status === 'VERIFIED') {
    return { tone: 'success', label: 'VERIFIED' };
  }
  if (status === 'PENDING_ONCHAIN') {
    return { tone: 'warning', label: 'Pending on Arc' };
  }
  return { tone: 'danger', label: status };
}

export function headroomUnavailableLabel(
  vehicle: FleetFlexibilityVehicle,
): string {
  if (!vehicle.headroom.ok) {
    if (vehicle.headroom.reason === 'missing_soc') {
      return 'Missing SoC';
    }
    if (vehicle.headroom.reason === 'missing_capacity') {
      return 'Missing battery capacity';
    }
    return 'Invalid SoC';
  }
  if (!vehicle.hasVerifiedReading) {
    return 'No reading yet';
  }
  return '—';
}

export function paymentStatusBadge(status: string): {
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  label: string;
} {
  if (status === 'confirmed') {
    return { tone: 'success', label: 'confirmed' };
  }
  if (status === 'failed' || status === 'reorged') {
    return { tone: 'danger', label: status };
  }
  if (status === 'pending' || status === 'verifying') {
    return { tone: 'warning', label: status };
  }
  return { tone: 'neutral', label: status };
}
