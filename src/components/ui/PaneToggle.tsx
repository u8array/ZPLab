import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from "@heroicons/react/16/solid";
import { Tooltip } from "./Tooltip";

/** Keep it at one tree position across both states, or folding drops the button's focus. */
export function PaneToggle({
  side,
  open,
  title,
  onToggle,
  onMouseDown,
  controls,
}: {
  side: "left" | "right";
  open: boolean;
  title: string;
  onToggle: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  /** Id of the body. Unset while folded, since aria-controls must not name a missing node. */
  controls?: string;
}) {
  // The chevrons point the way the panel moves: out of view while open, back in from the rail.
  const Icon = (side === "left") === open ? ChevronDoubleLeftIcon : ChevronDoubleRightIcon;
  const shape = open ? "px-2 flex items-center justify-center" : "w-5 h-full flex items-start justify-center pt-2 bg-surface hover:bg-surface-2";
  return (
    <Tooltip content={title} className={open ? undefined : "shrink-0 h-full"}>
      <button
        type="button"
        onClick={onToggle}
        onMouseDown={onMouseDown}
        aria-label={title}
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        className={`${shape} ${side === "left" ? "border-r" : "border-l"} border-border text-muted hover:text-text transition-colors`}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );
}
