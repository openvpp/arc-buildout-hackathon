import Link from 'next/link';

import { siteConfig } from '@/config/site';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-6 px-6">
      <div>
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Phase 1 · Frontend boilerplate
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {siteConfig.name}
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          {siteConfig.description}
        </p>
      </div>
      <Link
        href="/dashboard"
        className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
      >
        Open dashboard
      </Link>
    </main>
  );
}
