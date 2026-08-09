/**
 * Agent-posted verification status labels for dashboard and admin UI.
 * These values are agent-reported evidence, not server-authoritative chain auth.
 */
export function agentVerificationBadge(status: string | null | undefined): {
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  label: string;
} {
  if (status === null || status === undefined) {
    return { tone: 'neutral', label: 'No agent report' };
  }
  if (status === 'VERIFIED') {
    return { tone: 'success', label: 'Agent reported: VERIFIED' };
  }
  if (status === 'PENDING_ONCHAIN') {
    return { tone: 'warning', label: 'Agent reported: Pending on Arc' };
  }
  return { tone: 'danger', label: `Agent reported: ${status}` };
}
