import { Tooltip } from "./Tooltip";

export interface Segment<T extends string> {
  key: T;
  label: string;
  hint: string;
}

export function SegmentedStrip<T extends string>({
  label,
  segments,
  current,
  onPick,
}: {
  label: string;
  segments: Segment<T>[];
  current: T;
  onPick: (key: T) => void;
}) {
  return (
    <div className="inline-flex rounded border border-border overflow-hidden" aria-label={label}>
      {segments.map((segment, i) => (
        <Tooltip key={segment.key} content={segment.hint}>
          <button
            aria-current={current === segment.key ? "page" : undefined}
            onClick={() => onPick(segment.key)}
            className={`px-3 py-1 text-xs font-medium transition-colors ${i > 0 ? "border-l border-border" : ""} ${
              current === segment.key ? "bg-accent text-bg" : "text-muted hover:text-text hover:bg-surface-2"
            }`}
          >
            {segment.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
