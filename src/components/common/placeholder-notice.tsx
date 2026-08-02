/**
 * A prominent banner marking on-screen data as PLACEHOLDER, not live data.
 *
 * Required wherever example/placeholder structures are shown, so a reader can
 * never mistake development scaffolding for real telemetry, transactions, or
 * verification results.
 */
export function PlaceholderNotice({
  message = 'Placeholder data — not from a live backend. No telemetry, payment, or verification shown here is real.',
}: {
  message?: string;
}) {
  return (
    <div
      role="note"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
    >
      <span className="font-semibold">Placeholder:</span> {message}
    </div>
  );
}
