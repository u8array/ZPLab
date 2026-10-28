import Konva from "konva";
import type { KonvaNodeComponent } from "react-konva";

/** A ref patch lands after the transformer's first measurement, so the zero
 *  rect that keeps the HRI text out of the selection frame lives on the class. */
class HriOverlayNode extends Konva.Group {
  getClientRect(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}
// react-konva resolves an element type by name on the Konva namespace.
Object.assign(Konva, { HriOverlay: HriOverlayNode });

export const HriOverlay = "HriOverlay" as unknown as KonvaNodeComponent<Konva.Group, Konva.ContainerConfig>;
