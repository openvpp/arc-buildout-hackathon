export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
    </div>
  );
}
