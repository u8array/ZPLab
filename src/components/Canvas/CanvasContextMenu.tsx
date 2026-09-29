import {
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronDoubleUpIcon,
  ChevronDoubleDownIcon,
  Square2StackIcon,
  ScissorsIcon,
  DocumentDuplicateIcon,
  ClipboardIcon,
  TrashIcon,
  RectangleGroupIcon,
  RectangleStackIcon,
  LockClosedIcon,
  LockOpenIcon,
  CodeBracketIcon,
  PhotoIcon,
  ArrowDownTrayIcon,
  PlusIcon,
  Squares2X2Icon,
} from "@heroicons/react/16/solid";
import { ContextMenu, type MenuAction, type MenuSection } from "../ui/ContextMenu";

type IconType = typeof ChevronUpIcon;

// Icons stay in the view, keyed by the action id, so canvasActions stays pure.
const ICONS: Record<string, IconType> = {
  copy: Square2StackIcon,
  cut: ScissorsIcon,
  duplicate: DocumentDuplicateIcon,
  pasteHere: ClipboardIcon,
  delete: TrashIcon,
  toFront: ChevronDoubleUpIcon,
  forward: ChevronUpIcon,
  backward: ChevronDownIcon,
  toBack: ChevronDoubleDownIcon,
  group: RectangleGroupIcon,
  ungroup: RectangleStackIcon,
  copyZplSelected: CodeBracketIcon,
  copyZplLabel: CodeBracketIcon,
  copyImageSelected: PhotoIcon,
  exportImageSelected: ArrowDownTrayIcon,
  copyImageLabel: PhotoIcon,
  exportImageLabel: ArrowDownTrayIcon,
  addHere: PlusIcon,
  selectAll: Squares2X2Icon,
};

function iconFor(item: MenuAction): IconType | undefined {
  // The builder flips the lock row's labelKey to reflect current state.
  if (item.id === "lock") return item.labelKey === "unlock" ? LockOpenIcon : LockClosedIcon;
  return ICONS[item.id];
}

interface Props {
  sections: MenuSection[];
  /** Viewport coords of the right-click. */
  x: number;
  y: number;
  /** Resolved labels for `labelKey` (t.contextMenu). */
  labels: Record<string, string>;
  onClose: () => void;
}

export function CanvasContextMenu({ sections, x, y, labels, onClose }: Props) {
  return <ContextMenu sections={sections} x={x} y={y} labels={labels} iconFor={iconFor} onClose={onClose} />;
}
