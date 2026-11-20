import { describe, it, expect } from "vitest";
import { ACTION_BAR_GAP_PX, actionBarPosition } from "./useSelectionActionBar";
import { RULER_SIZE } from "../Ruler";

const HALF = { w: 75, h: 19 };
const STAGE = { width: 800, height: 600 };
const at = (minY: number, maxY: number, topInset = 0) =>
  actionBarPosition({ minX: 300, maxX: 340, minY, maxY }, HALF.w, HALF.h, STAGE.width, STAGE.height, topInset);

describe("actionBarPosition", () => {
  it("sits above the selection when the bar clears the ruler and below when it does not", () => {
    const fits = RULER_SIZE + ACTION_BAR_GAP_PX + 2 * HALF.h;
    expect(at(fits, fits + 40).y).toBe(fits - ACTION_BAR_GAP_PX - HALF.h);
    expect(at(fits - 1, fits + 39).y).toBe(fits + 39 + ACTION_BAR_GAP_PX + HALF.h);
  });

  it("leaves the top inset free above the selection and when neither side fits", () => {
    const inset = 21;
    const fits = RULER_SIZE + inset + ACTION_BAR_GAP_PX + 2 * HALF.h;
    expect(at(fits, fits + 40, inset).y).toBe(fits - ACTION_BAR_GAP_PX - HALF.h);
    expect(at(fits - 1, fits + 39, inset).y).toBe(fits + 39 + ACTION_BAR_GAP_PX + HALF.h);
    expect(at(30, STAGE.height - 10, inset).y).toBe(RULER_SIZE + inset + HALF.h);
  });
});
