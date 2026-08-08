import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/layout/dashboard-shell';
import { WalletConnectButton } from '@/features/auth';
import { DashboardSessionBridge } from '@/features/dashboard';

export default function DashboardGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DashboardShell headerActions={<WalletConnectButton />}>
      <DashboardSessionBridge />
      {children}
    </DashboardShell>
  );
}
