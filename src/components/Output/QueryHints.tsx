export function QueryHints({ hints }: { hints: readonly string[] }) {
  if (hints.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-1">
      {hints.map((hint) => (
        <p key={hint} className="font-mono text-[10px] text-amber-400 leading-snug">
          {hint}
        </p>
      ))}
    </div>
  );
}
