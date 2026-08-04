import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/layout/dashboard-shell';
import { WalletConnectButton } from '@/features/auth';

export default function DashboardGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DashboardShell headerActions={<WalletConnectButton />}>
      {children}
    </DashboardShell>
  );
}
