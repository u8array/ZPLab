import { describe, it, expect } from "vitest";
import { sanitizeRfidEpc } from "../types/LabelConfig";
import type { LabelConfig } from "../types/LabelConfig";

// Parser and UI keep the partitions summing to the bit count; a hand-edited
// design file must not slip an invalid ^RB past them.
describe("sanitizeRfidEpc", () => {
  const label = (over: Partial<LabelConfig>): LabelConfig =>
    ({ widthMm: 50, heightMm: 30, dpmm: 8, ...over }) as LabelConfig;

  it("keeps a pair whose partitions sum to the total", () => {
    const l = label({ rfidEpcBits: 96, rfidEpcPartitions: [8, 24, 64] });
    sanitizeRfidEpc(l);
    expect(l.rfidEpcBits).toBe(96);
    expect(l.rfidEpcPartitions).toEqual([8, 24, 64]);
  });

  it("drops the pair whole when the sum disagrees", () => {
    const l = label({ rfidEpcBits: 96, rfidEpcPartitions: [1] });
    sanitizeRfidEpc(l);
    expect(l.rfidEpcBits).toBeUndefined();
    expect(l.rfidEpcPartitions).toBeUndefined();
  });

  it("leaves an unpartitioned total alone", () => {
    const l = label({ rfidEpcBits: 96 });
    sanitizeRfidEpc(l);
    expect(l.rfidEpcBits).toBe(96);
  });
});
