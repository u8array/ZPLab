import { useState } from "react";
import { Group, Line, Rect, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  RFID_POSITION_DEFAULT,
  rfidPositionOf,
  rfidPositionValue,
} from "@zplab/core/lib/rfidPosition";
import { useLabelStore } from "../../store/labelStore";
import { CAPTURE_CHROME } from "./konvaObjectProps";

const HANDLE_W = 34;
const HANDLE_H = 14;
/** Backfeed reaches 30 mm before the leading edge (^RS B30). */
const BACKFEED_MM_MAX = 30;

/** Draggable ^RS programming-position guide: where the media stops so the
 *  transponder sits at the encoder, not where the inlay lies. Label config,
 *  so it draws with the safe-area guides rather than as an object. An unset
 *  position ghosts at the spec default; the first drag commits a value. */
export function RfidPositionGuide({
  labelX,
  labelY,
  labelWidthPx,
  labelHeightPx,
  scale,
  picking,
  onPicked,
  color,
  mutedColor,
}: {
  labelX: number;
  labelY: number;
  labelWidthPx: number;
  labelHeightPx: number;
  scale: number;
  /** Pick in progress: the label takes a click and previews the outcome. */
  picking: boolean;
  onPicked: () => void;
  color: string;
  mutedColor: string;
}) {
  const label = useLabelStore((s) => s.label);
  const setLabelConfig = useLabelStore((s) => s.setLabelConfig);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const value =
    rfidPositionValue(label.rfidPosition, label.dpmm) ??
    rfidPositionValue(RFID_POSITION_DEFAULT, label.dpmm);
  if (!value) return null;
  const committed = label.rfidPosition !== undefined;

  const yOf = (mm: number) => labelY + mm * scale;
  const captureY = yOf(-BACKFEED_MM_MAX);
  const clampY = (y: number) => Math.min(yOf(label.heightMm), Math.max(captureY, y));
  const wireAt = (y: number) =>
    rfidPositionOf((y - labelY) / scale, value.mode, label.dpmm, label.heightMm);
  const commit = (y: number) => setLabelConfig({ rfidPosition: wireAt(y) });
  // Pointer in the guide's own space: the canvas group rotates with the view,
  // so stage coordinates would land on the wrong axis at 90/270 degrees.
  const localY = (e: KonvaEventObject<MouseEvent>): number | null => {
    const rel = e.target.getRelativePointerPosition();
    return rel ? clampY(captureY + rel.y) : null;
  };

  const onDrag = (e: KonvaEventObject<DragEvent>) => {
    e.target.x(labelX);
    e.target.y(clampY(e.target.y()));
  };
  const endDrag = (e: KonvaEventObject<DragEvent>) => {
    commit(e.target.y());
    if (picking) onPicked();
  };

  const line = (y: number, stroke: string, text: string, ghost: boolean) => (
    <Group name={CAPTURE_CHROME} y={y} listening={false} opacity={ghost ? 0.5 : 1}>
      <Line points={[0, 0, labelWidthPx, 0]} stroke={stroke} strokeWidth={1.5} dash={[5, 3]} />
      <Rect
        x={labelWidthPx - HANDLE_W}
        y={-HANDLE_H / 2}
        width={HANDLE_W}
        height={HANDLE_H}
        cornerRadius={2}
        fill={stroke}
      />
      <Text
        x={labelWidthPx - HANDLE_W}
        y={-HANDLE_H / 2 + 3}
        width={HANDLE_W}
        align="center"
        text={text}
        fontSize={9}
        fontFamily="monospace"
        fill="#fff"
      />
    </Group>
  );

  return (
    <>
      {picking && (
        <Rect
          name={CAPTURE_CHROME}
          x={labelX}
          y={captureY}
          width={labelWidthPx}
          height={labelHeightPx + BACKFEED_MM_MAX * scale}
          opacity={0}
          onMouseMove={(e) => setHoverY(localY(e))}
          onMouseLeave={() => setHoverY(null)}
          onMouseDown={(e) => {
            // Konva bubbles to the stage, where a mousedown starts a lasso.
            e.cancelBubble = true;
            const y = localY(e);
            if (y !== null) commit(y);
            setHoverY(null);
            onPicked();
          }}
        />
      )}
      {/* Backfeed band above the leading edge: the only zone a `B` value can
          express, so a pick inside the label necessarily reads as forward. */}
      {picking && (
        <Group listening={false}>
          <Rect
            x={labelX}
            y={captureY}
            width={labelWidthPx}
            height={BACKFEED_MM_MAX * scale}
            fill={mutedColor}
            opacity={0.12}
          />
          <Text
            x={labelX + 4}
            y={captureY + 3}
            text="B"
            fontSize={10}
            fontFamily="monospace"
            fill={mutedColor}
          />
        </Group>
      )}
      {/* Live preview of the value a click would commit. */}
      {picking && hoverY !== null && (
        <Group x={labelX}>{line(hoverY, color, wireAt(hoverY), true)}</Group>
      )}
      <Group
        name={CAPTURE_CHROME}
        x={labelX}
        y={clampY(yOf(value.mm))}
        draggable
        onMouseDown={(e) => {
          e.cancelBubble = true;
        }}
        onDragMove={onDrag}
        onDragEnd={endDrag}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "ns-resize";
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "";
        }}
      >
        {/* Wide invisible strip so the 1px line stays grabbable. */}
        <Rect x={0} y={-6} width={labelWidthPx} height={12} opacity={0} />
        {line(0, committed ? color : mutedColor, label.rfidPosition ?? RFID_POSITION_DEFAULT, false)}
      </Group>
    </>
  );
}
