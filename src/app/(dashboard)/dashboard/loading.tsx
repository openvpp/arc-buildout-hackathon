export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite">
      <span className="sr-only">Loading dashboard…</span>
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800"
          />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}
