import type { Metadata } from 'next';

import { PageHeader } from '@/components/common/page-header';
import { ThemePreferenceControl } from '@/features/theme';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Appearance and Super Admin preferences.',
};

export default function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Local preferences for this browser. Appearance is stored on this device only and is shared with the main dashboard."
      />
      <section
        aria-labelledby="admin-settings-appearance-heading"
        className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 id="admin-settings-appearance-heading" className="sr-only">
          Appearance
        </h2>
        <ThemePreferenceControl />
      </section>
    </div>
  );
}
