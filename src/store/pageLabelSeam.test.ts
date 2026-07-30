import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Editor geometry runs in the CURRENT PAGE's dot scale, which is the design
// label only until a page carries its own ^JM. currentPageLabel is the one
// resolver; a raw `state.label` / `s.label` read in these files silently
// reintroduces the design density and misplaces every dot on a diverged page.
const GEOMETRY_FILES = [
  "../components/Palette/ObjectPalette.tsx",
  "../components/Canvas/LabelCanvas.tsx",
  "../components/Canvas/hooks/useKonvaDragController.ts",
  "../components/Properties/PropertiesPanel.tsx",
  "../components/Properties/UnitNumberInput.tsx",
  "../lib/footprintMeasurer.ts",
  "./slices/objectSlice.ts",
  "./slices/previewSlice.ts",
];

// Document-scope reads: they are about the design or the physical head, not
// about the dots of one page, so they legitimately stay on `state.label`.
const ALLOWED = [
  // The whole-document emit; generateMultiPageZPL resolves each page itself.
  "const designLabel = useLabelStore((s) => s.label);",
  // The dpmm / ^JM selectors and the rescale gate edit the design, not a page.
  "rescaleWouldChange(s.pages, s.label, includeCalibrationFields, patch)",
  // The Labelary URL picks the physical head the stream's ^JM applies to.
  "fetchPreview(zpl, state.label, endpoint.host, endpoint.apiKey)",
  // Explicit design scope: label-config fields are stored in the design's own
  // density, so a page ^JM must not rescale what they show or write back.
  "scope === 'design' ? s.label : currentPageLabel(s)",
  // Clock offsets are design-wide and carry no density.
  ".label.secondaryClockOffset",
  ".label.tertiaryClockOffset",
];

// No /g flag: a global regex keeps lastIndex across .test() calls and would
// silently skip lines whose match sits before the stale offset.
const LABEL_READ = /\b(?:state|s)\.label\b/;

describe("page-label seam", () => {
  it("editor geometry reads the page label, never the design label directly", () => {
    const offenders: string[] = [];
    for (const rel of GEOMETRY_FILES) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      for (const line of src.split("\n")) {
        if (!LABEL_READ.test(line)) continue;
        if (ALLOWED.some((a) => line.includes(a))) continue;
        offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A renamed or moved file would empty the scan without failing it.
  it("scans the files it claims to", () => {
    for (const rel of GEOMETRY_FILES) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      expect(src, rel).toContain("currentPageLabel");
    }
  });
});
