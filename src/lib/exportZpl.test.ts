import { describe, it, expect, beforeEach } from "vitest";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { finishZplExport } from "./exportZpl";
import { useLabelStore } from "../store/labelStore";
import type { Page } from "@zplab/core/types/Group";

const label = { widthMm: 70, heightMm: 40, dpmm: 8 };
const pages: Page[] = [
  {
    objects: [
      {
        id: "q", type: "qrcode", x: 10, y: 10, rotation: 90,
        props: { content: "https://example.test", magnification: 4, errorCorrection: "M", model: 2, rotation: "R" },
      } as never,
    ],
  },
];

beforeEach(() => useLabelStore.setState({ keepExportMetadata: false }));

describe("finishZplExport", () => {
  it("strips the label-meta and QR sidecars by default, keeping the printed fields", () => {
    const full = generateMultiPageZPL(label, pages);
    expect(full).toContain("^FXZPLLAB:");
    const out = finishZplExport(full);
    expect(out).not.toContain("ZPLLAB");
    expect(out).toContain("^GFA");
    expect(out).toContain("^PW560");
  });

  it("keeps the export byte-identical once the user opted in", () => {
    useLabelStore.setState({ keepExportMetadata: true });
    const full = generateMultiPageZPL(label, pages);
    expect(finishZplExport(full)).toBe(full);
  });
});
