import type { Ref } from "react";
import { Group } from "react-konva";
import type Konva from "konva";
import { visibleLeaves, type LabelObject } from "@zplab/core/types/Group";
import { designIdOf } from "@zplab/core/lib/repeatCopies";
import { KonvaObject } from "./KonvaObject";

interface Props {
  /** The copies of the page's repeating objects. */
  copies: readonly LabelObject[];
  scale: number;
  dpmm: number;
  offsetX: number;
  offsetY: number;
  /** The design leaves a drag moves. */
  movingIds: ReadonlySet<string>;
  /** The drag translates this group, which holds those copies. */
  movingRef: Ref<Konva.Group>;
  onSelect: (sourceId: string, add: boolean) => void;
}

const inert = { isSelected: false, onChange: () => undefined, snap: (dots: number) => dots };

/** The copies a repeating object prints on the other labels of the row. A click selects the object. */
export function RepeatCopies({ copies, scale, dpmm, offsetX, offsetY, movingIds, movingRef, onSelect }: Props) {
  const leaves = copies.flatMap((copy) =>
    // Locked, so no copy drags away from its source.
    visibleLeaves([copy]).map((leaf) => ({ sourceId: designIdOf(copy.id), leaf: { ...leaf, locked: true } })),
  );
  if (leaves.length === 0) return null;
  const draw = (moving: boolean) =>
    leaves
      .filter((c) => movingIds.has(designIdOf(c.leaf.id)) === moving)
      .map((c) => (
        <KonvaObject
          key={c.leaf.id}
          obj={c.leaf}
          scale={scale}
          dpmm={dpmm}
          offsetX={offsetX}
          offsetY={offsetY}
          {...inert}
          onSelect={(add) => onSelect(c.sourceId, add)}
        />
      ));
  return (
    <Group name="repeat-copies">
      {draw(false)}
      <Group ref={movingRef}>{draw(true)}</Group>
    </Group>
  );
}
