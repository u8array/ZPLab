interface Props {
  used: number;
  capacity: number;
  /** A slice of `used`, not an addition to it. */
  highlight?: number;
}

/** Proportions only. The caption beside it carries the numbers, so this stays out of the a11y tree. */
export function MemoryBar({ used, capacity, highlight = 0 }: Props) {
  if (capacity <= 0) return null;
  const share = (bytes: number) => `${Math.max(0, Math.min(100, (bytes / capacity) * 100))}%`;
  return (
    <div className="h-1.5 flex rounded overflow-hidden bg-surface-2" aria-hidden="true">
      <div data-part="used" className="bg-muted/50" style={{ width: share(used - highlight) }} />
      <div data-part="highlight" className="bg-accent" style={{ width: share(highlight) }} />
    </div>
  );
}
