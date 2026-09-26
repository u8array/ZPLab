import { payloadSettings } from "./payloadProps";
import type { ParsedPage, PageSource, SourceSpan } from "./zplParser/types";
import { parseZPL, type FontLossReason, type ImportFinding, type ImportReport, type ParsedZPL, type UnbalancedFormat } from "./zplParser";
import { DOCUMENT_FINDING, replayRiskFindings, reportOf } from "./importReport";
import { dropPageOverlays } from "./pageOverlay";
import { mergeSetupEntries } from "./setupEntries";
import { releaseStaged, stageImages, type CachedImage } from "./imageCache";
import { newId } from "./ids";
import type { ImportLossCause } from "../catalog";
import { renameTemplateMarkers } from "./fnTemplate";
import { PER_FORMAT_ZPL_FIELDS, effectiveDpmm, type CustomFontMapping, type JmDensity, type LabelConfig } from "../types/LabelConfig";
import { isSetupPath, type PrinterProfile, type SetupGraphic } from "../types/PrinterProfile";
import { exportableLeaves, type LabelObject, type Page, isGroup } from "../types/Group";
import { nextFreeFnNumber, uniqueVariableName, type ColumnMapping, type Variable } from "../types/Variable";
import type { DatasetInput } from "../types/DataSource";
import { BARCODE_1D_TYPES } from "../registry";
import { setupGraphicFits, storedGraphicShips, uploadKey, type ImageProps } from "../registry/image";
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
  /** Per page of `pages` (not the setup-routed list). */
  pageSources: PageSource[];
  variables: Variable[];
  report: ImportReport;
  /** True when ^XA blocks diverge in ^PW/^LL or ^JM density, which the
   *  single-label design shows only once, so other pages render/preflight
   *  wrong. Interactive import ignores it; the MCP tools reject on it. */
  mixedPageGeometry: boolean;
  /** First imbalance from the parser; the source editor refuses on it. */
  unbalanced: UnbalancedFormat | null;
  decodedImages: readonly CachedImage[];
  /** ^XF recall blocks of the stream's one ^DF template, folded into rows bound to its ^FN slots. */
  batch?: { dataset: DatasetInput; columnMapping: ColumnMapping };
}

const FONT_LOSS = {
  versionReplaced: "fontVersionReplaced",
  bitmapFont: "bitmapFont",
  notTrueTypeName: "fontNameNotTrueType",
} as const satisfies Record<FontLossReason, ImportLossCause>;

/** Document findings have no page, so the parser's partials map cannot dedup them. */
function noteDocumentLoss(findings: ImportFinding[], command: string, loss: ImportLossCause, span?: SourceSpan): void {
  if (findings.some((f) => f.pageIndex === DOCUMENT_FINDING && f.command === command && f.loss === loss)) return;
  findings.push({ kind: "partial", command, pageIndex: DOCUMENT_FINDING, loss, span });
}

interface RecallFold {
  templateIndex: number;
  /** One entry per replayed slot-only block, its values by ^FN slot. */
  rows: { pageIndex: number; values: ReadonlyMap<number, string> }[];
}

/** The slot-only blocks the parser replayed, as rows of the one template they all recall.
 *  Null when they recall more than one template, none, or one without slots, since a global dataset binds one design. */
function foldRecallPages(pages: readonly ParsedPage[]): RecallFold | null {
  const recalled = new Set(pages.flatMap((p) => (p.recall?.slotsOnly ? [p.recall.pageIndex] : [])));
  const [templateIndex] = recalled;
  if (templateIndex === undefined || recalled.size > 1 || pages[templateIndex]?.variables.length === 0) return null;
  const rows = pages.flatMap((page, pageIndex) =>
    page.recall?.pageIndex === templateIndex && page.recall.slotsOnly
      ? [{ pageIndex, values: new Map(page.variables.map((v) => [v.fnNumber, v.defaultValue])) }]
      : [],
  );
  return { templateIndex, rows };
}

export function importZplText(zpl: string, dpmm: number): ZplImportResult {
  // Single pass: stream-persistent state (^MU, ^CC/^CT/^CD, ^CI, ^CW/uploads,
  // ^CF/^BY, ^LH/^LT/^LR) carries across ^XA blocks, and the parser owns the
  // page boundaries (prefix-aware, unlike a literal ^XA split).
  const r = parseZPL(zpl, dpmm, { captureOverlay: true });
  // storedGraphicShips below reads the cache.
  const imageOwner = newId();
  stageImages(imageOwner, r.decodedImages);
  try {
    return assembleImport(r, dpmm);
  } finally {
    releaseStaged(imageOwner);
  }
}

function assembleImport(r: ParsedZPL, dpmm: number): ZplImportResult {
  const pages: Page[] = [];
  const pageSources: PageSource[] = [];
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
  const fold = foldRecallPages(r.pages);
  const rowByPage = new Map(fold?.rows.map((row) => [row.pageIndex, row]));
  // A row folds only once the template has a column for every slot it fills, so nothing it carries vanishes.
  const folded = new Set<number>();
  // Findings address the pages the import returns, which skip the folded rows.
  const foldedBefore: number[] = [];
  const outIndex = (i: number): number => i - (foldedBefore[i] ?? folded.size);
  const findingKey = (f: ImportFinding): string => `${f.kind}|${f.command}|${"loss" in f ? f.loss ?? "" : ""}`;
  // Filled from the template page's findings below, so a folded row repeats none of them.
  const rowFindingKeys = new Set<string>();
  // Rows are keyed by the slot as written, so the template's renumbered variables keep their source slot.
  let templateSlots: { sourceFn: number; kept: Variable }[] = [];
  const templateVariableIds = new Set<string>();

  r.pages.forEach((page, i) => {
    foldedBefore[i] = folded.size;
    const row = rowByPage.get(i);
    if (row && fold && templateSlots.length > 0 && [...row.values.keys()].every((fn) => templateSlots.some((slot) => slot.sourceFn === fn))) {
      folded.add(i);
      // The template's page is what stays visible, so a row's own findings land there, one per cause.
      for (const f of page.findings) {
        if (f.kind === "lossyEdit") continue;
        const key = findingKey(f);
        if (rowFindingKeys.has(key)) continue;
        rowFindingKeys.add(key);
        findings.push({ ...f, pageIndex: outIndex(fold.templateIndex) });
      }
      return;
    }
    // Its overlay covers only its own bytes, so the replayed objects go and the slot declarations return.
    if (page.recall) {
      const { objects: [o0, o1], variables: [v0, v1], declarations } = page.recall;
      page.objects = [...page.objects.slice(0, o0), ...page.objects.slice(o1)];
      page.variables = [...page.variables.slice(0, v0), ...declarations, ...page.variables.slice(v1)];
    }
    const keptHere: { sourceFn: number; kept: Variable }[] = [];
    // Objects link to their variable by marker NAME. When this page's variable
    // merges into an earlier page's (same ^FN number) under a different name,
    // OR a new fnNumber's name collides and gets disambiguated, its `«name»`
    // markers must be renamed to the kept variable's name.
    const nameRemap = new Map<string, string>();
    for (const v of page.variables) {
      const slotMates = variablesBySourceFn.get(v.fnNumber) ?? [];
      // An empty default is a bare slot declaration, not a divergent value, as the parser's in-page backfill reads it.
      // A template's slots are batch columns, so they never share a variable with another page.
      const mate = i === fold?.templateIndex ? undefined : slotMates.find(
        (m) => !templateVariableIds.has(m.id) && (m.defaultValue === v.defaultValue || m.defaultValue === "" || v.defaultValue === ""),
      );
      if (mate) {
        if (mate.defaultValue === "" && v.defaultValue !== "") mate.defaultValue = v.defaultValue;
        if (v.name !== mate.name) nameRemap.set(v.name, mate.name);
        keptHere.push({ sourceFn: v.fnNumber, kept: mate });
        continue;
      }
      let fnNumber = v.fnNumber;
      if (slotMates.length > 0) {
        const free = nextFreeFnNumber([...usedFns]);
        if (free === null) {
          // All 99 slots taken: fall back to the lossy merge rather than drop
          // the field's binding entirely.
          const first = slotMates[0];
          if (first && i !== fold?.templateIndex) keptHere.push({ sourceFn: v.fnNumber, kept: first });
          if (first && v.name !== first.name) nameRemap.set(v.name, first.name);
          findings.push({ kind: "fnDefaultDropped", command: `^FN${v.fnNumber}`, pageIndex: outIndex(i) });
          continue;
        }
        fnNumber = free;
        findings.push({ kind: "fnRenumbered", command: `^FN${v.fnNumber} → ^FN${free}`, pageIndex: outIndex(i) });
      }
      const uniqueName = uniqueVariableName(v.name, variables);
      if (uniqueName !== v.name) nameRemap.set(v.name, uniqueName);
      const kept: Variable = { ...v, name: uniqueName, fnNumber };
      variables.push(kept);
      keptHere.push({ sourceFn: v.fnNumber, kept });
      usedFns.add(fnNumber);
      variablesBySourceFn.set(v.fnNumber, [...slotMates, kept]);
    }
    if (i === fold?.templateIndex) {
      templateSlots = keptHere;
      for (const slot of keptHere) templateVariableIds.add(slot.kept.id);
      for (const f of page.findings) if (f.kind !== "hexControl") rowFindingKeys.add(findingKey(f));
      if (page.recallFormatPath !== undefined) rowFindingKeys.add(findingKey({ kind: "partial", command: `^XF${page.recallFormatPath}`, pageIndex: i }));
    }
    // A recall that stays a page is flagged by the format it recalled. A stored block's own ^XF is stored text.
    if (page.recallFormatPath !== undefined) {
      findings.push({ kind: "partial", command: `^XF${page.recallFormatPath}`, pageIndex: outIndex(i), span: page.recallFormatSpan, ...(page.storedFormatPath === undefined ? { loss: "recallFormat" } : {}) });
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
      // Sidecar density wins; under ^JMB the stream dots live halved.
      const fp = measureFootprintDots(
        resolved,
        effectiveDpmm({ dpmm: r.labelConfig.dpmm ?? dpmm, jmDensity: page.labelConfig.jmDensity }),
      );
      if (fp) {
        o.x -= fp.w;
        zNormalized = true;
      }
    }
    // A bare page (no ^XA wrapper) usually carries just fonts/profile. But a
    // wrapper-less paste of real fields also lands here; import those as a page
    // so they aren't silently dropped (no overlay: the wrapper-less source has
    // nothing to replay byte-for-byte, and re-export adds the ^XA/^XZ wrapper).
    const jmDensity = page.labelConfig.jmDensity;
    const storedFormatPath = page.storedFormatPath;
    if (!page.bare || page.objects.length > 0) {
      pages.push(page.bare ? { objects: page.objects, jmDensity, storedFormatPath } : { objects: page.objects, overlay: page.overlay, jmDensity, storedFormatPath });
      pageSources.push({ span: page.span, objectSpans: page.objectSpans, objectFrames: page.objectFrames });
    }
    for (const f of page.findings) {
      // A bare page replays nothing, so its lossyEdit caveat is moot.
      if (page.bare && f.kind === "lossyEdit") continue;
      findings.push({ ...f, pageIndex: outIndex(f.pageIndex) });
    }
  });

  // Single-label design: block 0 wins where it speaks. Other settings fall through from the first
  // block that sets them, as driver dumps carry ^PW/^LL/^MM only in the job block. The ^PQ family
  // falls through only from a folded row, and the parser carries it across ^XA, so a row's own value differs from the page before.
  const labelConfig: Partial<LabelConfig> = { ...r.pages[0]?.labelConfig };
  const perFormat = new Set<string>(PER_FORMAT_ZPL_FIELDS);
  r.pages.forEach((page, i) => {
    const before = r.pages[i - 1]?.labelConfig as Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(page.labelConfig)) {
      const rowSet = folded.has(i) && JSON.stringify(before?.[k]) !== JSON.stringify(v);
      if (v === undefined || (perFormat.has(k) && !rowSet) || k in labelConfig) continue;
      (labelConfig as Record<string, unknown>)[k] = v;
    }
  });
  // The stream carried z on a 1D field, so the target firmware supports
  // it; without the gate a later edit would regenerate z-less shifted bytes.
  if (zNormalized) labelConfig.emit1dZJustify = true;
  // Fonts stay document-wide.
  if (r.labelConfig.customFonts) labelConfig.customFonts = r.labelConfig.customFonts;
  else delete labelConfig.customFonts;
  // The dpmm sidecar is a page-0 preamble that overrides size.
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

  // A field reads a few settings from its payload, which only the replayed rows carry, so the first
  // row's settings become the design's. Nothing else is taken: a row ran under its own block's stream state.
  if (fold && folded.size > 0) {
    // Paired from the end, as the parser's replay comparison is.
    const templateObjects = r.pages[fold.templateIndex]?.objects ?? [];
    const rowObjects = fold.rows.filter((row) => folded.has(row.pageIndex)).map((row) => r.pages[row.pageIndex]?.objects ?? []);
    const rowLength = rowObjects[0]?.length ?? 0;
    const paired = templateObjects.slice(templateObjects.length - rowLength);
    const settingsOf = (o: LabelObject): string => JSON.stringify(payloadSettings(o));
    let disagree = false;
    paired.forEach((obj, k) => {
      const first = rowObjects[0]?.[k];
      if (!first || isGroup(obj) || isGroup(first) || first.type !== obj.type) return;
      obj.props = { ...obj.props, ...payloadSettings(first) } as typeof obj.props;
      const expected = settingsOf(first);
      if (rowObjects.some((objs) => objs.length === rowLength && objs[k] !== undefined && settingsOf(objs[k] as LabelObject) !== expected)) disagree = true;
    });
    if (disagree) findings.push({ kind: "partial", command: `^XF${r.pages[fold.rows[0]?.pageIndex ?? 0]?.recallFormatPath ?? ""}`, pageIndex: outIndex(fold.templateIndex), loss: "recallSettings" });
  }
  const templateVars = templateSlots.map((slot) => slot.kept);
  const foldedRows = fold?.rows.filter((row) => folded.has(row.pageIndex)) ?? [];
  const batch: ZplImportResult["batch"] | undefined =
    fold && foldedRows.length > 0
      ? {
          dataset: {
            headers: templateVars.map((v) => v.name),
            // A slot the block left out prints the template's own ^FD, as on the printer.
            rows: foldedRows.map((row) => templateSlots.map(({ sourceFn, kept }) => row.values.get(sourceFn) ?? kept.defaultValue)),
            source: { kind: "zpl", formatPath: r.pages[fold.templateIndex]?.storedFormatPath ?? "", importedAt: new Date().toISOString(), rowCount: foldedRows.length },
          },
          columnMapping: { bindings: Object.fromEntries(templateVars.map((v) => [v.id, v.name])), headerSnapshot: templateVars.map((v) => v.name) },
        }
      : undefined;

  const uploadedUnique = [...new Set(r.uploadedFontPaths)];
  const printerProfile: Partial<PrinterProfile> = { ...r.printerProfile };
  // A design font claims only the upload it ships. An upload it merely references stays provisioning.
  const setupFontPaths = uploadedUnique.filter((p) => !r.embeddedFontPaths.has(p));
  for (const f of r.fontLosses) noteDocumentLoss(findings, "~DY", FONT_LOSS[f.reason], f.span);
  // Refused here with a finding, or the whole profile patch fails and every field it carried drops in silence.
  const carriedFontPaths = setupFontPaths.filter((path) => {
    if (isSetupPath(path)) return true;
    noteDocumentLoss(findings, "~DY", "unshippableFontName");
    return false;
  });
  if (carriedFontPaths.length > 0) {
    printerProfile.setupFonts = carriedFontPaths.map((path) => ({ path }));
  }
  const shipped = new Set(
    r.pages.flatMap((page) => exportableLeaves(page.objects)).flatMap((leaf) => {
      const props = leaf.props as ImageProps;
      const key = leaf.type === "image" && storedGraphicShips(props) ? uploadKey(props) : undefined;
      return key ? [`${key}\n${props._gfaCache ?? ""}`] : [];
    }),
  );
  const setupGraphics: SetupGraphic[] = [];
  for (const g of r.uploadedGraphics) {
    if (shipped.has(`${g.path}\n${g.gfa}`)) continue;
    if (!isSetupPath(g.path)) {
      noteDocumentLoss(findings, g.via, "unshippableGraphicName");
      continue;
    }
    const fit = setupGraphicFits(g.gfa);
    if (fit !== "ok") {
      noteDocumentLoss(findings, g.via, fit === "tooLarge" ? "oversizeUpload" : "unshippableUpload");
      continue;
    }
    setupGraphics.push({ path: g.path, gfa: g.gfa });
  }
  if (setupGraphics.length > 0) printerProfile.setupGraphics = setupGraphics;

  if (r.mixedPageGeometry) {
    const sizes = [
      ...new Set(
        r.pages
          .map((p) => p.labelSize)
          .filter((sz) => sz.widthMm !== undefined || sz.heightMm !== undefined)
          .map((sz) => `${sz.widthMm ?? ''}x${sz.heightMm ?? ''}`),
      ),
    ];
    findings.push({ kind: 'mixedPageGeometry', command: sizes.join(', '), pageIndex: 0, cause: 'size' });
  }

  // ^JM is per-format on the wire; the single-label model folds it to the
  // first object-bearing block's density (unset there means full density).
  let jmDiverges = false;
  const anchorIndex = r.pages.findIndex((p) => p.objects.length > 0);
  if (anchorIndex >= 0) {
    const anchorJm = r.pages[anchorIndex]?.labelConfig.jmDensity;
    if (anchorJm === undefined) delete labelConfig.jmDensity;
    else labelConfig.jmDensity = anchorJm;
  }
  // Pages carry their density only as an override from the design (unset = A),
  // so a block that prints at A under a B-folded design is pinned to 'A'.
  const designJm: JmDensity = labelConfig.jmDensity ?? 'A';
  for (const page of pages) {
    const pageJm: JmDensity = page.jmDensity ?? 'A';
    if (pageJm === designJm) delete page.jmDensity;
    else page.jmDensity = pageJm;
  }
  const keptHalf = labelConfig.jmDensity === 'B';
  for (const [i, page] of r.pages.entries()) {
    if (i <= anchorIndex || page.objects.length === 0) continue;
    if ((page.labelConfig.jmDensity === 'B') !== keptHalf) {
      // Same page as the row's other findings, once per cause.
      const at = folded.has(i) && fold ? outIndex(fold.templateIndex) : outIndex(i);
      if (!findings.some((f) => f.kind === 'mixedPageGeometry' && f.cause === 'jm' && f.pageIndex === at)) {
        findings.push({ kind: 'mixedPageGeometry', command: '^JM', pageIndex: at, cause: 'jm' });
      }
      jmDiverges = true;
    }
  }

  const report = reportOf(findings);

  return {
    ...(batch ? { batch } : {}),
    labelConfig,
    printerProfile,
    pages,
    pageSources,
    variables,
    report,
    mixedPageGeometry: r.mixedPageGeometry || jmDiverges,
    unbalanced: r.unbalanced,
    decodedImages: r.decodedImages,
  };
}

/** Current label patched with the imported stream, except ^JM, which the
 *  import always sets (absent means full density): inheriting the open
 *  document's mode would reinterpret every imported dot at the wrong scale. */
export function replaceImportLabel(
  current: LabelConfig,
  imported: Partial<LabelConfig>,
): LabelConfig {
  const merged = { ...current, ...imported };
  if (imported.jmDensity === undefined) delete merged.jmDensity;
  return merged;
}

/** Re-pin appended pages to their true ^JM density against the joined design.
 *  Append drops the import's own design density, so a page whose folded
 *  density differs from the target must carry it as an explicit override. */
export function rebaseAppendedPageDensity(
  pages: Page[],
  importJmDensity: JmDensity | undefined,
  designJmDensity: JmDensity | undefined,
): Page[] {
  const designJm = designJmDensity ?? 'A';
  const importJm = importJmDensity ?? 'A';
  return pages.map((p) => {
    const pageJm = p.jmDensity ?? importJm;
    return pageJm === designJm ? { ...p, jmDensity: undefined } : { ...p, jmDensity: pageJm };
  });
}

export function mergeSetupUploads(
  current: Partial<PrinterProfile>,
  imported: Partial<PrinterProfile>,
): { patch: Partial<PrinterProfile>; changed: { fonts: number; graphics: number } } {
  const patch = { ...imported };
  const changed = { fonts: 0, graphics: 0 };
  if (imported.setupFonts) {
    const r = mergeSetupEntries(current.setupFonts, imported.setupFonts);
    patch.setupFonts = r.merged;
    changed.fonts = r.changed;
  }
  if (imported.setupGraphics) {
    const r = mergeSetupEntries(current.setupGraphics, imported.setupGraphics);
    patch.setupGraphics = r.merged;
    changed.graphics = r.changed;
  }
  return { patch, changed };
}

/** Routing for imported setup commands. */
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
  // remove: every other profile field is replayRisk-derived, so keeping only the uploads strips exactly those.
  const { setupFonts, setupGraphics } = result.printerProfile;
  const printerProfile: Partial<PrinterProfile> = {
    ...(setupFonts ? { setupFonts } : {}),
    ...(setupGraphics ? { setupGraphics } : {}),
  };
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
