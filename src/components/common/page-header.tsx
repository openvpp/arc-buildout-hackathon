export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      {description !== undefined ? (
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      ) : null}
    </div>
  );
}
