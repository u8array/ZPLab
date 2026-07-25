import { parseZPL, type ImportFinding, type ImportReport } from "./zplParser";
import { replayRiskFindings, dedupCommandsByKind } from "./importReport";
import { dropPageOverlays } from "./pageOverlay";
import { stripDrivePrefix } from "./customFonts";
import { renameTemplateMarkers } from "./fnTemplate";
import type { CustomFontMapping, LabelConfig } from "../types/LabelConfig";
import type { PrinterProfile } from "../types/PrinterProfile";
import type { LabelObject, Page } from "../types/Group";
import { nextFreeFnNumber, uniqueVariableName, type Variable } from "../types/Variable";
import { BARCODE_1D_TYPES } from "../registry";
import { verifiedZJustifyCombo } from "../registry/zplHelpers";
import { resolveForMeasure } from "./barcodeDims";
import { clockCtxFromLabel } from "./variableBinding";
import { measureFootprintDots } from "./footprintProber";

export interface ZplImportResult {
  labelConfig: Partial<LabelConfig>;
  /** Setup-Script fields extracted from the import. Caller decides
   *  whether to overwrite the active printer profile (e.g. only when
   *  the user explicitly opts in); design imports should typically
   *  NOT auto-apply these so a shared `.zpl` can't silently
   *  reconfigure the user's printer. */
  printerProfile: Partial<PrinterProfile>;
  pages: Page[];
  variables: Variable[];
  report: ImportReport;
  /** True when ^XA blocks set different ^PW/^LL: the single-label design keeps
   *  only block 0's size, so later pages would render/preflight at the wrong
   *  size. Interactive import ignores it; the MCP tools reject on it. */
  mixedPageGeometry: boolean;
}

export function importZplText(zpl: string, dpmm: number): ZplImportResult {
  // Single pass: stream-persistent state (^MU, ^CC/^CT/^CD, ^CI, ^CW/uploads,
  // ^CF/^BY, ^LH/^LT/^LR) carries across ^XA blocks, and the parser owns the
  // page boundaries (prefix-aware, unlike a literal ^XA split).
  const r = parseZPL(zpl, dpmm, { captureOverlay: true });

  const pages: Page[] = [];
  const findings: ImportFinding[] = [];
  // Variables are document-level; pages merge by source fnNumber only when
  // the ^FD defaults agree (^FN is scoped per ^XA format, so a shared slot
  // with a different default is a distinct field). A divergent default
  // becomes a separate Variable on a free fnNumber, keeping fn
  // document-unique for mapping/batch/header.
  const variables: Variable[] = [];
  let zNormalized = false;
  const variablesBySourceFn = new Map<number, Variable[]>();
  // Renumbering must avoid every source ^FN in the document (overlays replay
  // original bytes, so a regenerated field would otherwise collide).
  const usedFns = new Set<number>(r.sourceFnNumbers);

  r.pages.forEach((page, i) => {
    // Objects link to their variable by marker NAME. When this page's variable
    // merges into an earlier page's (same ^FN number) under a different name,
    // OR a new fnNumber's name collides and gets disambiguated, its `«name»`
    // markers must be renamed to the kept variable's name.
    const nameRemap = new Map<string, string>();
    for (const v of page.variables) {
      const slotMates = variablesBySourceFn.get(v.fnNumber) ?? [];
      // An empty default is a bare slot declaration, not a divergent value
      // (mirrors the parser's in-page backfill semantics).
      const mate = slotMates.find(
        (m) => m.defaultValue === v.defaultValue || m.defaultValue === "" || v.defaultValue === "",
      );
      if (mate) {
        if (mate.defaultValue === "" && v.defaultValue !== "") mate.defaultValue = v.defaultValue;
        if (v.name !== mate.name) nameRemap.set(v.name, mate.name);
        continue;
      }
      let fnNumber = v.fnNumber;
      if (slotMates.length > 0) {
        const free = nextFreeFnNumber([...usedFns]);
        if (free === null) {
          // All 99 slots taken: fall back to the lossy merge rather than drop
          // the field's binding entirely.
          const first = slotMates[0];
          if (first && v.name !== first.name) nameRemap.set(v.name, first.name);
          findings.push({ kind: "fnDefaultDropped", command: `^FN${v.fnNumber}`, pageIndex: i });
          continue;
        }
        fnNumber = free;
        findings.push({ kind: "fnRenumbered", command: `^FN${v.fnNumber} → ^FN${free}`, pageIndex: i });
      }
      const uniqueName = uniqueVariableName(v.name, variables);
      if (uniqueName !== v.name) nameRemap.set(v.name, uniqueName);
      const kept: Variable = { ...v, name: uniqueName, fnNumber };
      variables.push(kept);
      usedFns.add(fnNumber);
      variablesBySourceFn.set(v.fnNumber, [...slotMates, kept]);
    }
    // Rename this page's content markers onto the kept variable names.
    // Defensive walk into groups; the parser does not produce groups, but the
    // helper is shape-agnostic.
    if (nameRemap.size > 0) {
      rewireBindings(page.objects, nameRemap);
    }
    // ^FO/^FT + rotation N (ZD230-verified mirror); rotated z needs the
    // axis-aware shift first. Text unshifted (import measurement fragile).
    // Markers resolve against the IMPORTED bindings (defaults, no dataset row)
    // so the shift can't depend on whatever document happens to be open.
    for (const o of page.objects) {
      if (!BARCODE_1D_TYPES.has(o.type) || !verifiedZJustifyCombo(o)) continue;
      const resolved = resolveForMeasure(o, variables, clockCtxFromLabel(page.labelConfig));
      // Sidecar density wins: the stream's dot values live in ITS dpmm.
      const fp = measureFootprintDots(resolved, r.labelConfig.dpmm ?? dpmm);
      if (fp) {
        o.x -= fp.w;
        zNormalized = true;
      }
    }
    // A bare page (no ^XA wrapper) usually carries just fonts/profile. But a
    // wrapper-less paste of real fields also lands here; import those as a page
    // so they aren't silently dropped (no overlay: the wrapper-less source has
    // nothing to replay byte-for-byte, and re-export adds the ^XA/^XZ wrapper).
    if (!page.bare) {
      pages.push({ objects: page.objects, overlay: page.overlay });
    } else if (page.objects.length > 0) {
      pages.push({ objects: page.objects });
    }
    for (const f of page.findings) {
      // A bare page replays nothing, so its lossyEdit caveat is moot.
      if (page.bare && f.kind === "lossyEdit") continue;
      findings.push(f);
    }
  });

  // Single-label design: keep block 0's config. Per-format fields like ^PQ are
  // block-scoped, so the document-accumulated last-write would leak later
  // blocks' values. Fonts stay document-wide, and the ZPLLAB sidecar (dpmm,
  // which plain ZPL can't carry) is a page-0 preamble that overrides the size.
  const labelConfig: Partial<LabelConfig> = { ...r.pages[0]?.labelConfig };
  // The stream carried z on a 1D field, so the target firmware supports
  // it; without the gate a later edit would regenerate z-less shifted bytes.
  if (zNormalized) labelConfig.emit1dZJustify = true;
  if (r.labelConfig.customFonts) labelConfig.customFonts = r.labelConfig.customFonts;
  else delete labelConfig.customFonts;
  if (r.labelConfig.dpmm !== undefined) {
    labelConfig.dpmm = r.labelConfig.dpmm;
    labelConfig.widthMm = r.labelConfig.widthMm;
    labelConfig.heightMm = r.labelConfig.heightMm;
  }

  // Dedup ^CW font entries by alias (a re-stated alias resolves to the last
  // definition, as on the printer).
  const fontEntries = labelConfig.customFonts ?? [];
  const byAlias = new Map<string, CustomFontMapping>();
  for (const m of fontEntries) {
    if (m.alias) byAlias.set(m.alias, m);
  }
  if (byAlias.size > 0) {
    labelConfig.customFonts = [...byAlias.values()];
  }

  // Uploaded fonts not claimed as design fonts are Setup-Script fonts.
  // Case-insensitive compare since external streams vary in casing.
  const normPath = (p: string) => p.trim().toUpperCase();
  // Strip only the uploaded side: driveless refs match any drive on the
  // printer, but two drived refs on different drives stay distinct.
  const strippedNorm = (p: string) => stripDrivePrefix(normPath(p));
  const designFontPaths = new Set<string>();
  for (const m of fontEntries) {
    if (m.path) designFontPaths.add(normPath(m.path));
  }
  for (const p of r.referencedFontPaths) designFontPaths.add(normPath(p));
  const uploadedUnique = [...new Set(r.uploadedFontPaths)];
  const uploadedNormed = new Map(uploadedUnique.map((p) => [normPath(p), p]));
  const uploadedStripped = new Map(uploadedUnique.map((p) => [strippedNorm(p), p]));
  const printerProfile: Partial<PrinterProfile> = { ...r.printerProfile };
  const setupFontPaths = uploadedUnique.filter(
    (p) => !designFontPaths.has(normPath(p)) && !designFontPaths.has(strippedNorm(p)),
  );
  if (setupFontPaths.length > 0) {
    printerProfile.setupFonts = setupFontPaths.map((path) => ({ path }));
  }

  // Backfill embedInZpl + previewFontName on entries whose path matches an
  // uploaded font: covers a ^CW that precedes its ~DY upload, which the
  // in-pass handler cannot see.
  for (const m of labelConfig.customFonts ?? []) {
    if (!m.path) continue;
    const upload = uploadedNormed.get(normPath(m.path))
      ?? uploadedStripped.get(strippedNorm(m.path));
    if (!upload || m.embedInZpl) continue;
    m.embedInZpl = true;
    const colon = upload.indexOf(":");
    const filename = colon >= 0 ? upload.slice(colon + 1) : upload;
    if (filename && !m.previewFontName) m.previewFontName = filename;
  }

  if (r.mixedPageGeometry) {
    const sizes = [
      ...new Set(
        r.pages
          .map((p) => p.labelSize)
          .filter((sz) => sz.widthMm !== undefined || sz.heightMm !== undefined)
          .map((sz) => `${sz.widthMm ?? ''}x${sz.heightMm ?? ''}`),
      ),
    ];
    findings.push({ kind: 'mixedPageGeometry', command: sizes.join(', '), pageIndex: 0 });
  }

  // Bucket views deduplicate by command code to match the JSDoc contract on
  // ImportReport (zplParser/types.ts). The per-occurrence model lives in
  // `findings`; consumers that only need the set of distinct affected commands
  // read these buckets unchanged. Only command-based kinds get a bucket; a
  // block-level kind like 'lossyEdit' stays in `findings` by design.
  const report: ImportReport = {
    findings,
    partial: dedupCommandsByKind(findings, 'partial'),
    browserLimit: dedupCommandsByKind(findings, 'browserLimit'),
    unknown: dedupCommandsByKind(findings, 'unknown'),
    replayRisk: dedupCommandsByKind(findings, 'replayRisk'),
    deviceAction: dedupCommandsByKind(findings, 'deviceAction'),
  };

  return {
    labelConfig,
    printerProfile,
    pages,
    variables,
    report,
    mixedPageGeometry: r.mixedPageGeometry,
  };
}

/** Additive setup-font merge (dedupe by normalized path): a stream lists only
 *  its own uploads and expresses no deletion. */
export function mergeSetupFonts(
  existing: readonly { path: string }[] | undefined,
  incoming: readonly { path: string }[],
): { path: string }[] {
  const base = existing ?? [];
  const seen = new Set(base.map((f) => f.path.trim().toUpperCase()));
  const added = incoming.filter((f) => !seen.has(f.path.trim().toUpperCase()));
  return [...base, ...added];
}

/** Routing for imported setup commands: keep in label, keep only in the
 *  setup-script channel (profile), or drop entirely (setup fonts stay). */
export type SetupCommandChoice = "keep" | "setupScript" | "remove";

/** Apply a SetupCommandChoice to a parsed import (pure). The label re-emits
 *  setup commands only via overlay raw bytes, so routing them out drops those
 *  pages' overlays: model regen never emits setup commands. */
export function routeSetupCommands(
  choice: SetupCommandChoice,
  result: ZplImportResult,
): { printerProfile: Partial<PrinterProfile>; pages: Page[]; keptPageIndexes: number[] } {
  if (choice === "keep") {
    return {
      printerProfile: result.printerProfile,
      pages: result.pages,
      keptPageIndexes: result.pages.map((_p, i) => i),
    };
  }
  const riskPages = new Set(replayRiskFindings(result.report).map((f) => f.pageIndex));
  // A routed page left empty (setup-only block) must not survive as a blank
  // page; keptPageIndexes lets the report drop/remap its findings.
  const dropped = dropPageOverlays(result.pages, (_p, i) => riskPages.has(i));
  const pages: Page[] = [];
  const keptPageIndexes: number[] = [];
  dropped.forEach((p, i) => {
    if (p.objects.length > 0 || !riskPages.has(i)) {
      pages.push(p);
      keptPageIndexes.push(i);
    }
  });
  if (choice === "setupScript") {
    return { printerProfile: result.printerProfile, pages, keptPageIndexes };
  }
  // remove: every profile field except setupFonts is replayRisk-derived, so
  // keeping only setupFonts strips exactly those.
  const printerProfile: Partial<PrinterProfile> = result.printerProfile.setupFonts
    ? { setupFonts: result.printerProfile.setupFonts }
    : {};
  return { printerProfile, pages, keptPageIndexes };
}

/** In-place rewrite of cross-block variable references on freshly-parsed objects
 *  (not yet in the store, so mutation is safe). Renames `«name»` content markers
 *  to the kept (merged or renumbered) variable's name. The pages must NOT be
 *  marked dirty: their captured bytes stay valid as-is, and an unedited later
 *  page would otherwise lose its original ^FD default on export. */
function rewireBindings(
  objects: LabelObject[],
  nameRemap: ReadonlyMap<string, string>,
): void {
  for (const obj of objects) {
    const leaf = obj as { props?: { content?: string } };
    if (typeof leaf.props?.content === "string") {
      // Single pass against original names: a cross-block swap can't cascade.
      leaf.props.content = renameTemplateMarkers(leaf.props.content, nameRemap);
    }
    if (obj.type === "group" && "children" in obj) {
      rewireBindings(obj.children, nameRemap);
    }
  }
}
