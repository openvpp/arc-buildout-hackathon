export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-white">{title}</h1>
      {description !== undefined ? (
        <p className="mt-1 text-sm text-white/60">{description}</p>
      ) : null}
    </div>
  );
}
