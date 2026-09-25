export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-white/15 p-8 text-center">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-sm text-white/60">{description}</p>
    </div>
  );
}
