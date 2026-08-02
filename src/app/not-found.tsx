import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-4 px-6">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        404
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-slate-600 dark:text-slate-400">
        The page you are looking for does not exist or has moved.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
