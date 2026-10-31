import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect } from "vitest";

// The brand's one blind spot: a cast mints it out of thin air, so the set of
// minting sites is pinned here instead of by the type.
const MINTERS = [
  "packages/core/src/types/LabelConfig.ts",
  "packages/core/src/types/Group.ts",
  "packages/core/src/lib/zplGenerator.ts",
  "src/store/labelStore.selectors.ts",
];
const MINT = /\bdesignAsPageLabel\(|\bas PageLabel\b/;

// generateZPL keeps its LabelConfig param (decision documented at the
// function); production callers are pinned so a new one gets a conscious
// page-scope check instead of silently passing a design label.
const GENERATE_ZPL_CALLERS = [
  "packages/core/src/lib/zplGenerator.ts",
  "src/lib/printPreview.ts",
];
const GENERATE_ZPL_CALL = /\bgenerateZPL\(/;

// Files the brand cannot reach: they read scalars off the label (dpmm, clock
// offsets) or a density-free field subset, where a design label is
// structurally identical to a page-resolved one.
const UNBRANDABLE_FILES = [
  "../components/Canvas/LabelCanvas.tsx",
  "../components/Properties/PropertiesPanel.tsx",
  "../components/Properties/UnitNumberInput.tsx",
  "../lib/footprintMeasurer.ts",
  "./slices/objectSlice.ts",
];

// Document-scope reads: they are about the design or the physical head, not
// about the dots of one page, so they legitimately stay on `state.label`.
const ALLOWED = [
  // Label-config fields are edited in the design's own density.
  "const designLabel = useLabelStore((s) => s.label);",
  // The rescale gate edits the design, not a page.
  "rescaleWouldChange(s.pages, s.label, includeCalibrationFields, patch)",
  // Explicit design scope: a page ^JM must not rescale what the field shows.
  "scope === 'design' ? s.label : currentPageLabel(s)",
  // Physical scope: ^PW/^LL are raw head dots, unaffected by any ^JM.
  "if (scope === 'physical') return s.label.dpmm;",
  // Clock offsets are design-wide and carry no density.
  ".label.secondaryClockOffset",
  ".label.tertiaryClockOffset",
  // normalizeChanges ctx reads customFonts/defaultFontId, both design-scoped.
  "applyObjectChanges(obj, changes, ancestorLocked, state.label)",
  "applyObjectChanges(n, changes, inheritedLocked, state.label)",
];

// No /g flag: a global regex keeps lastIndex across .test() calls and would
// silently skip lines whose match sits before the stale offset.
const LABEL_READ = /\b(?:state|s)\.label\b/;

describe("page-label seam", () => {
  it("the scalar readers take their dots from the page label, never the design label", () => {
    const offenders: string[] = [];
    for (const rel of UNBRANDABLE_FILES) {
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
    for (const rel of UNBRANDABLE_FILES) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      expect(src, rel).toContain("currentPageLabel");
    }
  });

  describe("pinned sites", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    let sources: { file: string; text: string }[];

    beforeAll(() => {
      // Not from `packages`: that would walk every installed dependency.
      // No existence check: a renamed tree must fail, not shrink the scan.
      const packageTrees = readdirSync(root + "packages").map((p) => `packages/${p}/src`);
      sources = ["src", "e2e", ...packageTrees]
        .flatMap((tree) =>
          readdirSync(root + tree, { recursive: true, encoding: "utf8" }).map(
            (f) => `${tree}/${f.replaceAll("\\", "/")}`,
          ),
        )
        .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
        .map((file) => ({ file, text: readFileSync(root + file, "utf8") }));
    });

    const filesMatching = (re: RegExp): string[] =>
      sources.filter((s) => re.test(s.text)).map((s) => s.file);

    it("only the documented resolvers mint the PageLabel brand", () => {
      expect(filesMatching(MINT).sort()).toEqual(MINTERS.sort());
    });

    it("only the pinned callers invoke the unbranded generateZPL entry", () => {
      expect(filesMatching(GENERATE_ZPL_CALL).sort()).toEqual(GENERATE_ZPL_CALLERS.sort());
    });
  });
});
