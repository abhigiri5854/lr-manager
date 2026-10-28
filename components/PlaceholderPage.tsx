// Temporary stand-in so sidebar links resolve. Replace with the real screen.
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 text-[28px] font-bold">{title}</h1>
      <p className="m-0 text-muted">This screen is not built yet.</p>
    </div>
  );
}
