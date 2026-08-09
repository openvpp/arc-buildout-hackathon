import { StatusBadge } from '@/components/ui/status-badge';

import type { OwnerVerifyResponse } from './owner-telemetry-api';

export function ownerVerifyStatusBadge(status: OwnerVerifyResponse['status']): {
  tone: 'success' | 'warning' | 'danger';
  label: string;
} {
  if (status === 'VERIFIED') {
    return { tone: 'success', label: 'Agent reported: VERIFIED' };
  }
  if (status === 'PENDING_ONCHAIN') {
    return { tone: 'warning', label: 'Agent reported: Pending on Arc' };
  }
  return { tone: 'danger', label: `Agent reported: ${status}` };
}

export function OwnerVerifyStatusBadge({
  status,
}: {
  readonly status: OwnerVerifyResponse['status'];
}) {
  const badge = ownerVerifyStatusBadge(status);
  return <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>;
}
