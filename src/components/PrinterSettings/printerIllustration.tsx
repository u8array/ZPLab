import { createContext, useContext, useState, type ReactNode } from "react";
import { rfidPositionValue } from "@zplab/core/lib/rfidPosition";
import { useLabelStore } from "../../store/labelStore";

/** Physical printer regions the settings fields map onto. The illustration
 *  highlights the focused field's region, driver-dialog style, so a user sees
 *  WHERE on the device a value acts before understanding the ZPL behind it. */
export type PrinterRegion =
  | "printhead"
  | "exit"
  | "feed"
  | "backfeed"
  | "sensor"
  | "label"
  | "originX"
  | "originY"
  | "top"
  | "shift"
  | "stack"
  | "antenna";

type Source = "focus" | "hover";

interface FocusCtx {
  region: PrinterRegion | null;
  set: (src: Source, r: PrinterRegion) => void;
  clear: (src: Source, r: PrinterRegion) => void;
}

const Ctx = createContext<FocusCtx | null>(null);

export function IllustrationFocusProvider({ children }: { children: ReactNode }) {
  // Track keyboard focus and pointer hover separately; focus wins. Sharing one
  // slot let a pointer-leave clear a still-focused field's highlight.
  const [focusR, setFocusR] = useState<PrinterRegion | null>(null);
  const [hoverR, setHoverR] = useState<PrinterRegion | null>(null);
  // Clear only if still the active region: a blur of field A arriving after
  // field B's focus must not wipe B's highlight.
  const guard = (r: PrinterRegion) => (cur: PrinterRegion | null) => (cur === r ? null : cur);
  const set = (src: Source, r: PrinterRegion) => (src === "focus" ? setFocusR(r) : setHoverR(r));
  const clear = (src: Source, r: PrinterRegion) =>
    src === "focus" ? setFocusR(guard(r)) : setHoverR(guard(r));
  return (
    <Ctx.Provider value={{ region: focusR ?? hoverR, set, clear }}>{children}</Ctx.Provider>
  );
}

/** Wrapper that reports focus/hover of any child field as a region. Focus
 *  events bubble in React, so the existing field primitives need no props. */
export function RegionFocus({
  region,
  children,
  className,
}: {
  region: PrinterRegion;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  if (!ctx) return <>{children}</>;
  return (
    <div
      className={className}
      onFocus={() => ctx.set("focus", region)}
      onBlur={(e) => {
        // Tab between two fields of the SAME group fires blur before focus;
        // only clear when focus actually leaves the wrapper, else the
        // highlight flickers off and on within one region.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          ctx.clear("focus", region);
        }
      }}
      onPointerEnter={() => ctx.set("hover", region)}
      onPointerLeave={() => ctx.clear("hover", region)}
    >
      {children}
    </div>
  );
}

/** Class pair for a highlightable region: the caller's idle look by default,
 *  accent when the focused field maps onto it. Physical parts pass a ghost
 *  idle (opacity-40); the offset/motion markers pass opacity-0 (hidden until
 *  their field is touched). */
function cls(active: boolean, idle: string): string {
  return active ? "text-accent opacity-100" : idle;
}

/** Stylized front view of a desktop label printer with the label path,
 *  after the driver dialogs' preview pane. Decorative; fields carry the
 *  semantics, so the SVG stays aria-hidden. */
export function PrinterIllustration() {
  const ctx = useContext(Ctx);
  const r = ctx?.region ?? null;
  // ^PO flips the print 180 degrees: the corner bracket marks where the
  // label's TOP ends up (normal: top-left, inverted: bottom-right). It yields
  // to the axis markers, which draw in the same corner area.
  const inverted = useLabelStore((s) => s.label.printOrientation) === "I";
  // ^MM state gadget at the exit: tear serration, peel liner, cutter blade
  // or kiosk retainers, so the chosen mode is visible without focusing it.
  const mediaMode = useLabelStore((s) => s.label.mediaMode);
  // ^MT state gadget at the head: thermal transfer shows the ribbon roll in
  // the lid, direct thermal the heat acting straight on the media.
  const mediaType = useLabelStore((s) => s.label.mediaType);
  // ^MN state gadget on the strip: what the sensor actually detects. Endlos
  // hides the label boundary entirely; gap/web show the die-cut notches,
  // mark the black mark, auto a scanning sensor.
  const tracking = useLabelStore((s) => s.label.mediaTracking);
  // RFID gadgets: inlay + encoder waves ride the ^RS position when one is
  // set (absolute dots or F-mm over the label length; B sits at the leading
  // edge), waves scale with the write power, VOID previews on exit focus.
  const rfidSet = useLabelStore(
    (s) =>
      s.label.rfidTagType !== undefined ||
      s.label.rfidPosition !== undefined ||
      s.label.rfidEpcBits !== undefined ||
      s.label.rfidReadPower !== undefined ||
      s.label.rfidWritePower !== undefined,
  );
  // The whole gadget set also ghosts while the RFID tab itself is open, so
  // browsing the tab explains the geometry before any value is set.
  const rfidTabActive = useLabelStore((s) => s.printerSettingsTab === "rfid");
  const rfidPosition = useLabelStore((s) => s.label.rfidPosition);
  const rfidWritePower = useLabelStore((s) => s.label.rfidWritePower);
  const rfidVoid = useLabelStore((s) => s.label.rfidVoidLength !== undefined);
  const heightMm = useLabelStore((s) => s.label.heightMm);
  const dpmm = useLabelStore((s) => s.label.dpmm);
  const STRIP_TOP = 56;
  const STRIP_HEIGHT = 56;
  // Same reader as the canvas guide, so both pictures cannot drift apart.
  const rfidValue = rfidPositionValue(rfidPosition, dpmm);
  const rfidLine =
    rfidValue === null
      ? null
      : STRIP_TOP + Math.min(1, Math.max(0, rfidValue.mm / heightMm)) * STRIP_HEIGHT;
  const rfidY = rfidLine !== null ? Math.min(105, Math.max(63, rfidLine)) : 102.5;
  const waves =
    rfidWritePower === undefined
      ? 2
      : rfidWritePower === "H"
        ? 3
        : rfidWritePower === "M"
          ? 2
          : rfidWritePower === "L"
            ? 1
            : rfidWritePower <= 10
              ? 1
              : rfidWritePower <= 20
                ? 2
                : 3;
  const axisMarkerActive =
    r === "originX" || r === "originY" || r === "top" || r === "shift";
  return (
    <div className="px-3 pt-3 pb-1 border-b border-border">
      <svg viewBox="0 0 176 152" aria-hidden="true" className="w-full h-auto">
        {/* label strip FIRST so the housing lip overlaps it (strip emerges
            from the slot): leading label, perforation, torn trailing label */}
        <rect x="52" y="56" width="72" height="56" rx="1.5" className={r === "label" ? "text-accent fill-surface" : "text-border fill-surface"} stroke="currentColor" strokeWidth="1.5" />
        <rect x="58" y="82" width="44" height="4" rx="1" className="text-border" fill="currentColor" />
        <rect x="58" y="92" width="60" height="4" rx="1" className="text-border" fill="currentColor" />
        {/* perforation to the trailing label (quantities) + torn tail */}
        <g className={cls(r === "stack", "text-border opacity-80")}>
          {tracking !== "N" && (
            <line x1="52" y1="112" x2="124" y2="112" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2.5" />
          )}
          <path d="M52 112 v22 l6 6 6 -6 6 6 6 -6 6 6 6 -6 6 6 6 -6 6 6 6 -6 6 6 6 -6 v-22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </g>
        {/* printer housing: clamshell body with domed lid */}
        <path d="M10 62 v-34 q0 -8 8 -8 h140 q8 0 8 8 v34 z" className="fill-surface text-border" stroke="currentColor" strokeWidth="1.5" />
        {/* domed lid tint + parting line */}
        <path d="M10 36 v-8 q0 -8 8 -8 h140 q8 0 8 8 v8 z" className="text-muted opacity-15" fill="currentColor" />
        <line x1="10" y1="36" x2="166" y2="36" className="text-border" stroke="currentColor" strokeWidth="1" />
        {/* status LED + feed button */}
        <circle cx="150" cy="28" r="2.5" className="text-accent opacity-80" fill="currentColor" />
        <rect x="140" y="44" width="14" height="5" rx="2.5" className="text-muted opacity-50" fill="currentColor" />
        {/* printhead bar behind the slot (darkness, thermal mode, head test) */}
        <rect x="26" y="42" width="104" height="6" rx="2" className={cls(r === "printhead", "text-muted opacity-50")} fill="currentColor" />
        {/* ^MT gadgets: ribbon roll in the lid vs direct heat on the media */}
        {mediaType === "T" && (
          <g className={cls(r === "printhead", "text-muted opacity-60")}>
            <circle cx="62" cy="29" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="62" cy="29" r="1.5" fill="currentColor" />
            <line x1="62" y1="34.5" x2="62" y2="42" stroke="currentColor" strokeWidth="2.5" />
          </g>
        )}
        {mediaType === "D" && (
          <path
            d="M66 52 q2 -3 4 0 q2 3 4 0 M84 52 q2 -3 4 0 q2 3 4 0 M102 52 q2 -3 4 0 q2 3 4 0"
            className={cls(r === "printhead", "text-muted opacity-60")}
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          />
        )}
        {/* dark exit slot with tear lip; the strip passes through it */}
        <rect x="40" y="54" width="96" height="8" rx="2" className={cls(r === "exit", "text-text opacity-60")} fill="currentColor" />
        <line x1="40" y1="64" x2="136" y2="64" className={cls(r === "exit", "text-border")} stroke="currentColor" strokeWidth="1.5" />
        {/* media sensors flanking the slot (tracking) */}
        <path d="M32 58 l6 -4 v8 z" className={cls(r === "sensor", "text-muted opacity-40")} fill="currentColor" />
        <path d="M144 58 l-6 -4 v8 z" className={cls(r === "sensor", "text-muted opacity-40")} fill="currentColor" />
        {/* ^MN tracking gadgets */}
        {(tracking === "Y" || tracking === "W") && (
          <g className={cls(r === "sensor", "text-muted opacity-60")}>
            <rect x="49.5" y="109.5" width="5" height="5" rx="1" className="fill-surface" stroke="currentColor" strokeWidth="1.5" />
            <rect x="121.5" y="109.5" width="5" height="5" rx="1" className="fill-surface" stroke="currentColor" strokeWidth="1.5" />
          </g>
        )}
        {tracking === "M" && (
          <rect x="53" y="105" width="9" height="4.5" rx="1" className={cls(r === "sensor", "text-muted opacity-60")} fill="currentColor" />
        )}
        {tracking === "A" && (
          <path
            d="M41 53.5 a7 7 0 0 1 0 9 M45 50 a12 12 0 0 1 0 16"
            className={cls(r === "sensor", "text-muted opacity-60")}
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          />
        )}
        {/* ^MM mode gadgets */}
        {mediaMode === "T" && (
          <path
            d="M52 64 l4.5 6 4.5 -6 4.5 6 4.5 -6 4.5 6 4.5 -6 4.5 6 4.5 -6 4.5 6 4.5 -6 4.5 6 4.5 -6 4.5 6 4.5 -6 4.5 6 4.5 -6"
            className={cls(r === "exit", "text-muted opacity-60")}
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
          />
        )}
        {mediaMode === "V" && (
          <path
            d="M50 64 Q30 72 24 98 M24 98 l-3 -6 M24 98 l6 -3"
            className={cls(r === "exit", "text-muted opacity-60")}
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          />
        )}
        {mediaMode === "D" && (
          <g className={cls(r === "exit", "text-muted opacity-60")}>
            <path d="M128 60 v12 l10 -6 z" fill="currentColor" />
            <line x1="52" y1="66" x2="124" y2="66" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 3" />
          </g>
        )}
        {mediaMode === "K" && (
          <g className={cls(r === "exit", "text-muted opacity-60")} fill="currentColor">
            <rect x="49" y="65" width="4" height="9" rx="1.5" />
            <rect x="123" y="65" width="4" height="9" rx="1.5" />
          </g>
        )}
        {/* ^PO top-of-label bracket, flips with the orientation setting */}
        <path
          d={inverted ? "M108 108 h12 v-12" : "M56 84 v-12 h12"}
          className={axisMarkerActive ? "opacity-0" : cls(r === "label", "text-muted opacity-40")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* ^LH origin, split per axis: X = distance from the LEFT label edge,
            Y = distance from the TOP edge. Hidden until the field is focused
            or hovered; both visible at once would overlap into noise. */}
        <g className={cls(r === "originX", "opacity-0")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M56 70 v16" />
          <path d="M56 78 h12 M64 74 l6 4 -6 4" strokeWidth="2" />
        </g>
        <g className={cls(r === "originY", "opacity-0")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M54 70 h16" />
          <path d="M62 70 v12 M58 78 l4 6 4 -6" strokeWidth="2" />
        </g>
        {/* ^LT top-edge marker (first printable edge under the slot) */}
        <path d="M52 68 h72 M88 62 v12" className={cls(r === "top", "opacity-0")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        {/* ^LS lateral shift arrows */}
        <path d="M60 102 h56 M66 98 l-6 4 6 4 M110 98 l6 4 -6 4" className={cls(r === "shift", "opacity-0")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* RFID inlay + encoder waves, a state gadget like ^MM/^MT. The
            wave count scales with the write power (L/M/H or thirds of 0-30). */}
        {(rfidSet || rfidTabActive || r === "antenna") && (
          <g className={cls(r === "antenna", "text-muted opacity-40")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="76" y={rfidY - 4.5} width="9" height="9" rx="1.5" />
            {waves >= 1 && <path d={`M89 ${rfidY - 4.5} a7 7 0 0 1 0 9`} />}
            {waves >= 2 && <path d={`M93 ${rfidY - 7.5} a12 12 0 0 1 0 15`} />}
            {waves >= 3 && <path d={`M97 ${rfidY - 10.5} a17 17 0 0 1 0 21`} />}
            {rfidWritePower !== undefined && (
              <text x="104" y={rfidY + 3} fontSize="8" fontFamily="monospace" fill="currentColor" stroke="none">
                {String(rfidWritePower)}
              </text>
            )}
          </g>
        )}
        {/* ^RS programming position: encode line across the strip, placed
            proportionally (absolute dots / F-mm over the label length;
            B-forms sit at the leading edge). */}
        {rfidLine !== null && (
          <g className={cls(r === "antenna", "text-muted opacity-40")}>
            <line
              x1="52" y1={rfidLine} x2="124" y2={rfidLine}
              stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3"
            />
            <text x="126" y={rfidLine + 3} fontSize="8" fontFamily="monospace" fill="currentColor">
              {rfidPosition}
            </text>
          </g>
        )}
        {/* ^RS VOID handling: the failed label prints VOID on its way out */}
        {(rfidVoid || rfidTabActive) && r === "exit" && (
          <text x="88" y="90" textAnchor="middle" className="text-accent" fill="currentColor"
            fontSize="11" fontWeight="bold" transform="rotate(-14 88 90)" letterSpacing="2">VOID</text>
        )}
        {/* media motion beside the strip: ^MF feeds forward, ^XB/~JS back */}
        <path d="M136 72 v24 M130 90 l6 8 6 -8" className={cls(r === "feed", "opacity-0")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M136 100 v-24 M130 82 l6 -8 6 8" className={cls(r === "backfeed", "opacity-0")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
