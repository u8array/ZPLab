import { bindFontEmbeds } from "./customFonts";
import { DEFAULT_CLOCK_CHARS } from "./fcTemplate";
import { unescapeGs1FdValue, zplFdToModelContent } from "./gs1";
import { code128PlainExclusiveFns, gs1ModeDExclusiveFns } from "./gs1ModeDFns";
import { code128FdToBytes, hasControlBytes } from "./code128Subset";
import { planCode128Fd } from "./code128Plan";
import { extractTemplateRefs, hasTemplateMarkers } from "./fnTemplate";
import { controlBytesToMarkers, resolveControlMarkers } from "../types/controlKey";
import { isLoneMarker } from "./variableField";
import { markerOf } from "../types/Variable";
import { getObjectStringContent } from "./variableBinding";
import { parseLabelMetaComment, type LabelMeta } from "./zplLabelMeta";
import { stripLineWrap, stripTrailingSpaces, tokenize, trimmedSpanEnd, type ZplToken } from "./zplParser/helpers";
import { lookaheadJmDensity, lookaheadStoredFormat, scanBareStream } from "./zplHeadScan";
import { parseStoragePath, recallCandidates, storageKey } from "./storagePath";
import { printShape } from "./payloadProps";
import { qrPrintsAsGraphic } from "./objectBounds";
import { commandTakesPrefix, commandTwinSplit } from "../catalog";
import { claimVariableName, createParserState, deriveUnitScale, REGEN_LOSSY_REASONS, notePartial, openTailHasContent, payloadSummary, releaseVariableName, resetFormatScopedState, type FnDefaultCandidate, type PartialNote, type RegenLossyReason, type SpannedToken, type UnterminatedField, resolveLiveFonts } from "./zplParser/context";
import { createCloseField } from "./zplParser/flushField";
import { createBarcodeHandlers } from "./zplParser/handlers/barcodes";
import { createDynamicFontAWildcard, createFieldHandlers } from "./zplParser/handlers/fields";
import { createGraphicsHandlers } from "./zplParser/handlers/graphics";
import { createLabelConfigHandlers } from "./zplParser/handlers/labelConfig";
import { createSetupScriptHandlers } from "./zplParser/handlers/setupScript";
import { createUnitsHandler } from "./zplParser/handlers/units";
import { createUnsupportedHandlers } from "./zplParser/handlers/unsupported";
import { buildBlockOverlay, type BlockOverlay, type DfSpan, type FormatHead, type OverlayFrame, type JmSpan, type LinkedSpan } from "./zplOverlay/overlay";
import type {
  Handler,
  ImportFinding,
  ParsedPage,
  ParsedZPL,
  SourceSpan,
  UnbalancedFormat,
  Wildcard,
} from "./zplParser/types";
export type {
  ImportFindingKind,
  ImportFinding,
  ImportReport,
  ParsedPage,
  ParsedZPL,
  FontLossReason,
  UnbalancedFormat,
} from "./zplParser/types";
import type { LabelObject } from "../types/Group";
import type { Variable } from "../types/Variable";

/** Page-close override of the upsert-order default. Runs BEFORE the
 *  mode-D/code128 normalizers, whose slots carry wire-form candidates. */
function adoptFnDefaultCandidates(
  variables: Variable[],
  candidates: ReadonlyMap<number, FnDefaultCandidate>,
  templateFns: ReadonlySet<number>,
): void {
  for (const v of variables) {
    const rec = candidates.get(v.fnNumber);
    if (rec?.decoded && !templateFns.has(v.fnNumber)) {
      v.defaultValue = rec.value;
    }
  }
}

/** Lone-marker vs. template consumers per ^FN slot; shared by all page-close
 *  default passes so their whole-payload criterion cannot drift. */
function fnConsumerShapes(
  objects: readonly LabelObject[],
  variables: readonly Variable[],
): { loneFns: Set<number>; templateFns: Set<number> } {
  const fnByVarName = new Map(variables.map((v) => [v.name, v.fnNumber]));
  const loneFns = new Set<number>();
  const templateFns = new Set<number>();
  for (const o of objects) {
    const c = getObjectStringContent(o);
    if (c === undefined || !hasTemplateMarkers(c)) continue;
    const target = isLoneMarker(c) ? loneFns : templateFns;
    for (const name of extractTemplateRefs(c)) {
      const fn = fnByVarName.get(name);
      if (fn !== undefined) target.add(fn);
    }
  }
  return { loneFns, templateFns };
}

/** Normalize mode-D-exclusive ^FN defaults to model form (inverse of the emit
 *  escape; mixed slots stay raw, see gs1ModeDExclusiveFns). A lone-marker slot
 *  holds the whole payload and gets the full decode; an embedded slot is one
 *  AI's value, where canonicalization could mutate bytes (GTIN check digit), so
 *  only the >0 escape reverses. Scoped per page: a later page reusing the same
 *  ^FN number with a plain field must not inherit this page's GS1 decode. */
function normalizeModeDDefaults(
  objects: readonly LabelObject[],
  variables: Variable[],
  loneFns: ReadonlySet<number>,
): void {
  const modeDFns = gs1ModeDExclusiveFns(objects, variables);
  if (modeDFns.size === 0) return;
  for (const v of variables) {
    if (!modeDFns.has(v.fnNumber)) continue;
    v.defaultValue = loneFns.has(v.fnNumber)
      ? (zplFdToModelContent(v.defaultValue) ?? unescapeGs1FdValue(v.defaultValue))
      : unescapeGs1FdValue(v.defaultValue);
  }
}

/** Inverse of the plain-^BC ^FN-default escape (flushField leaves ^FN
 *  payloads verbatim: only this pass knows slot exclusivity). Adopts only
 *  byte-identical re-encodes; returns true when a default's regen would
 *  rewrite the imported bytes (lossyEdit signal). */
function normalizeCode128PlainDefaults(
  objects: readonly LabelObject[],
  variables: Variable[],
  shapes: { loneFns: ReadonlySet<number>; templateFns: ReadonlySet<number> },
): boolean {
  const plainFns = code128PlainExclusiveFns(objects, variables);
  if (plainFns.size === 0) return false;
  const { loneFns, templateFns } = shapes;
  let regenLossy = false;
  for (const v of variables) {
    if (!plainFns.has(v.fnNumber)) continue;
    const pureLone = loneFns.has(v.fnNumber) && !templateFns.has(v.fnNumber);
    const bytes = code128FdToBytes(v.defaultValue);
    let adopted = false;
    if (bytes !== null && hasControlBytes(bytes)) {
      // Raw C0 in the decode = invocation-form default; chips-free domain.
      if (pureLone && planCode128Fd(bytes, "whole").fd === v.defaultValue) {
        v.defaultValue = controlBytesToMarkers(bytes);
        adopted = true;
      }
    } else if (bytes !== null && bytes !== v.defaultValue
        && planCode128Fd(bytes, "templateValue").fd === v.defaultValue) {
      // Marker-PRESERVING domain: whole mode would resolve chips and never
      // match a chipified default. Identity adoption (bytes === default)
      // falls through to the lossy check.
      v.defaultValue = bytes;
      adopted = true;
    }
    if (adopted) continue;
    // Not adopted: the plan says what regen emits; flag when that rewrites
    // the imported bytes (chips resolve either way, compare against both).
    const emitted = planCode128Fd(v.defaultValue, pureLone ? "whole" : "templateValue").fd;
    if (emitted !== v.defaultValue && emitted !== resolveControlMarkers(v.defaultValue)) {
      regenLossy = true;
    }
  }
  return regenLossy;
}

/** Barcode object types whose module width comes from ^BY (mirrors the
 *  `s.defaults.byModuleWidth` consumers in flushField). 2D codes that carry
 *  their own magnification (qrcode/datamatrix/aztec/maxicode) are excluded, so
 *  editing a 2D-code label stays regenSafe. */
export const BY_CONSUMING_BARCODE_TYPES = new Set<string>([
  "code128", "code39", "ean13", "upce", "upca", "ean8", "interleaved2of5",
  "code93", "code11", "industrial2of5", "standard2of5", "codabar", "logmars",
  "msi", "plessey", "planet", "postal", "upcEanExtension", "gs1databar",
  "pdf417", "code49", "micropdf417", "codablock", "tlc39",
]);

/** Commands whose replay acts on the device, not the design. A catalog rule cannot stand in: web
 *  support "no" plus a handler also holds for ^FM, ^HT and ^LF. */
export const DEVICE_ACTION_IDS: ReadonlySet<string> = new Set([
  "~JA", "~JC", "~JD", "~JE", "^JI", "~JI", "~JR", "^ID", "^IS", "~EG",
  "~PH", "~PP", "~PM", "~PR", "^JS",
]);

/** Commands defining persistent state a later field may consume implicitly;
 *  in-span they make single-field regen unsafe (the span replace drops the
 *  definition). ^BY absent: consumers self-flag via sawBareBarcode; ^JM is
 *  legal pre-^FS, so it can sit in a field span too. */
const PERSISTENT_DEF_CODES = new Set(["CF", "FW", "CW", "SO", "LH", "LT", "JM", "DG", "DY"]);

/** Why this page cannot be regenerated byte for byte, or undefined when it can.
 *  The overlay flag and the user-facing wording read the same derivation, so a
 *  cause can no longer be counted by one and worded by the other. */
function regenLossReason(
  pg: {
    regenHostileFormat: boolean;
    sawNonUtf8Ci: boolean;
    sawBareBarcode: boolean;
  },
  /** A declaration kept as raw bytes that the scoped header re-emits on regen. */
  declared: boolean,
  /** A field or upload whose bytes regeneration would change. */
  lossyReason: RegenLossyReason | undefined,
): string | undefined {
  if (pg.sawNonUtf8Ci) return "a non-UTF-8 ^CI encoding";
  if (pg.sawBareBarcode) return "a barcode without an in-field ^BY";
  if (declared) return "an ^FN declaration without a field";
  if (pg.regenHostileFormat) {
    return "a non-default format state (prefix, delimiter, unit, out-of-field ^FE/^FC, ^LR, or a definition inside a field)";
  }
  return lossyReason;
}

/** Parse a ZPL II byte stream into an editable design model. `captureOverlay`
 *  builds a source-patch overlay (segments linking each object to its bytes;
 *  gaps preserved as raw) for byte-identical re-export. Off by default. */
export function parseZPL(
  zpl: string,
  dpmm = 8,
  opts: { captureOverlay?: boolean } = {},
): ParsedZPL {
  const s = createParserState();
  const tokens = tokenize(zpl, s.format);
  // partials stays behind s.result: the map is swapped at each page close
  // so per-format repeats of a command are re-reported on their own page.
  const {
    objects, labelConfig, printerProfile, variables,
    browserLimit, unknown, replayRisk, deviceAction, unterminated, hexControl,
  } = s.result;

  const takeComment = (): string | undefined => {
    const c = s.comment.pending;
    s.comment.pending = undefined;
    return c;
  };

  const overlaySpans: LinkedSpan[] = [];
  const linkedIds = new Set<string>();
  const linkedFrames = new Map<string, OverlayFrame>();
  const linkObject = (start: number, end: number, objectId: string, frame = pg.ovFrame) => {
    overlaySpans.push({ start, end, link: { kind: "object", objectId } });
    linkedIds.add(objectId);
    if (frame) linkedFrames.set(objectId, frame);
  };
  /** The home the bytes being linked were folded with, so a regenerated field emits home-relative. */
  const currentFrame = (): OverlayFrame | null =>
    s.label.lhX !== 0 || s.label.lhY !== 0 || s.label.ltY !== 0 ? { homeX: s.label.lhX, homeY: s.label.lhY, top: s.label.ltY } : null;
  const graphicsFamily = createGraphicsHandlers(s, {
    takeComment,
    onReverseBgCommitted: (bg, box) => {
      if (bg.span) linkObject(bg.span.start, bg.span.end, box.id);
    },
    onStandaloneObject: (obj) => {
      const span = s.result.tokenSpan;
      // The ^FX run the object took as its comment is part of its bytes, or an edit re-emits it twice.
      if (span && s.recall === null) linkObject(s.comment.run?.start ?? span.start, span.end, obj.id, currentFrame());
    },
    onUpload: (key, short) => {
      const span = s.result.tokenSpan;
      // Inside an open field the bytes belong to that field's span, which PERSISTENT_DEF_CODES makes regen-hostile.
      if (!span || pg.ovStart !== null || s.recall !== null) return;
      overlaySpans.push({ start: span.start, end: s.result.tokenEnd ?? span.end, link: { kind: "upload", key, ...(short ? { short: true } : {}) } });
    },
  });
  const { commitPendingReverseBg, getReverseFlag } = graphicsFamily.helpers;
  const closeField = createCloseField(s, {
    commitPendingReverseBg,
    getReverseFlag,
    takeComment,
  });

  const resetComment: Handler = (_, rest) => {
    s.comment.pending = rest.trim() || undefined;
  };
  // Our geometry sidecar heads every exported block, so every block consumes one;
  // the settings are document-level, so the first wins and later ones are dropped,
  // never shown as comments. A body ^FX reaches an empty block only after a
  // discard emptied it, hence the second guard.
  const labelMeta: { value: LabelMeta | null } = { value: null }; // holder: the closure write survives TS narrowing
  // Multi-line ^FX before a field accumulate; XA/XZ reset at label boundaries.
  const appendComment: Handler = (_, rest) => {
    const run = s.comment.run ?? { start: s.result.tokenSpan?.start ?? 0, text: "" };
    s.comment.run = run;
    const next = rest.trim();
    if (!next) return;
    if (objects.length === pg.obj && unterminated.length === pg.unterminated) {
      const meta = parseLabelMetaComment(next);
      if (meta) {
        labelMeta.value ??= meta;
        return;
      }
    }
    s.comment.pending = s.comment.pending ? `${s.comment.pending}\n${next}` : next;
    run.text = run.text ? `${run.text}\n${next}` : next;
  };

  const handlers: Record<string, Handler> = {
    XA: (p, rest, cmd) => {
      commitPendingReverseBg();
      s.format.embedChar = "#";
      s.format.clockChars = { ...DEFAULT_CLOCK_CHARS };
      s.format.inFormatHead = true;
      resetComment(p, rest, cmd);
    },
    XZ(p, rest, cmd) {
      // ZD230-measured: a field still open at ^XZ prints, so it is modelled.
      closeField();
      commitPendingReverseBg();
      // Between formats there is no head: a ^JM out here is neither read by the
      // next format's lookahead nor rewritable, so it must not be taken for one.
      s.format.inFormatHead = false;
      resetComment(p, rest, cmd);
    },
  };

  Object.assign(handlers, createBarcodeHandlers(s));
  Object.assign(handlers, createFieldHandlers(s, { closeField, appendComment }));
  Object.assign(handlers, graphicsFamily.handlers);
  const setupScriptHandlers = createSetupScriptHandlers(s);
  const replayRiskCodes = new Set(Object.keys(setupScriptHandlers));
  // Commands whose last param is literal data, where a trailing space is real (^SN, ^SF, ^A@), not line-wrap noise.
  const LITERAL_TAIL_CMDS = new Set(["SN", "SF", "A@"]);
  Object.assign(handlers, setupScriptHandlers);
  Object.assign(handlers, createLabelConfigHandlers(s, dpmm));
  Object.assign(handlers, createUnitsHandler(s, dpmm));
  Object.assign(handlers, createUnsupportedHandlers(s));

  // Wildcard handlers are tried only after exact-match dispatch fails,
  // so a handler-table entry always wins over a pattern-match.
  const wildcards: Wildcard[] = [createDynamicFontAWildcard(s)];

  // Page bookkeeping: one page per ^XA block, closed at the NEXT ^XA (so the
  // inter-block separator stays with the preceding page, which the overlay
  // replay relies on). Page 0 opens at offset 0 and owns any preamble.
  const pages: ParsedPage[] = [];
  let mixedPageGeometry = false;
  // The open format's ^XA, or null: one variable, so "a format is open" and
  // "where it opened" cannot disagree. A format left open never prints (spec
  // p. 375) and its overlay would replay the broken bytes, so callers refuse.
  let openXa: { at: number; cmd: string } | null = null;
  // First imbalance only: the best anchor to point the editor at.
  let unbalanced: UnbalancedFormat | null = null;
  let lastPageW: number | undefined;
  let lastPageH: number | undefined;

  /** Page-scoped parse state, replaced wholesale at each page close so a new
   *  flag cannot miss the boundary reset. */
  const freshPageScope = (start: number) => ({
    // `start` plus the array-length marks delimit this page's slice of the
    // shared result arrays.
    start,
    obj: objects.length,
    vari: variables.length,
    browser: browserLimit.length,
    unknown: unknown.length,
    replay: replayRisk.length,
    device: deviceAction.length,
    unterminated: unterminated.length,
    hexControl: hexControl.length,
    span: overlaySpans.length,
    // Open field's source start (^FO/^FT or its leading ^FX run). Only clean
    // single-object fields and deferred reverse-bg boxes link; anything else
    // trips the all-linked gate and the block regenerates.
    ovStart: null as number | null,
    // Stamped at ^XZ with a field still open, so export can terminate it.
    openTail: false,
    // The ^LH/^LT the opener folded into the field's coordinates.
    ovFrame: null as OverlayFrame | null,
    // In-span ^BY sightings, from the tokenizer (so ^CC/^CD remaps count):
    // any form, and one that fills the h slot the ^FO QR position depends on.
    spanHasBy: false,
    spanByHasH: false,
    // Format state that would re-interpret a regenerated object's bytes on
    // replay; drives the overlay's regenSafe flag (verbatim replay unaffected).
    regenHostileFormat: false,
    // Format head for the export-time ^JM pass: injection point and the head's
    // own ^JM spans, block-relative. Re-armed at this page's ^XA; a block
    // without one keeps at 0, where a ^JM is equally valid.
    head: {
      caret: s.format.caretChar,
      at: 0,
      jmSpans: [] as JmSpan[],
      dfSpans: undefined as DfSpan[] | undefined,
    } satisfies FormatHead,
    sawNonUtf8Ci: false,
    sawBareBarcode: false,
    storedFormatPath: undefined as string | undefined,
    recallOnly: false,
  });
  let pg = freshPageScope(0);

  // A wrapper-less stream has no ^XA for the lookahead to hang off, so its own
  // leading ^JM is resolved here instead; a ^JM ahead of a real ^XA is not.
  const bare = scanBareStream(zpl, s.format, s.format.delimiterChar);
  s.format.inFormatHead = !bare.hasXa;
  if (bare.density) {
    s.format.jmDensity = bare.density;
    labelConfig.jmDensity = bare.density;
    s.format.unitScale = deriveUnitScale(s.format, dpmm);
  }
  // No head to record spans in: the wrapper-less source regenerates anyway.
  pg.storedFormatPath = bare.storedFormat?.path;

  const bucketFindings = (
    pageIndex: number,
    partial: readonly PartialNote[],
    browser: readonly SpannedToken[],
    unk: readonly SpannedToken[],
    replay: readonly SpannedToken[],
    device: readonly SpannedToken[],
    dropped: readonly UnterminatedField[],
    hexControl: readonly SpannedToken[],
  ): ImportFinding[] => [
    ...partial.map((n): ImportFinding => ({ kind: "partial", command: n.command, pageIndex, span: n.span, loss: n.loss })),
    ...dropped.map((u): ImportFinding => ({ kind: "unterminatedField", command: zpl.slice(u.opener.start, u.opener.end), pageIndex, span: { start: u.opener.start, end: trimmedSpanEnd(zpl, u.opener.start, u.end) } })),
    ...browser.map((t): ImportFinding => ({ kind: "browserLimit", command: t.command, pageIndex, span: t.span })),
    ...unk.map((t): ImportFinding => ({ kind: "unknown", command: t.command, pageIndex, span: t.span })),
    ...replay.map((t): ImportFinding => ({ kind: "replayRisk", command: t.command, pageIndex, span: t.span })),
    ...device.map((t): ImportFinding => ({ kind: "deviceAction", command: t.command, pageIndex, span: t.span })),
    ...hexControl.map((t): ImportFinding => ({ kind: "hexControl", command: t.command, pageIndex, span: t.span })),
  ];

  /** Close the current page at source offset `end`: per-format serial-orphan
   *  sweep, per-page findings/overlay, then reset the format-scoped state so
   *  the next page starts clean (printer-persistent state carries on). */
  // Judged at page close, once bytes behind the ^XZ have had their say.
  let pendingClose: { kind: "store"; template: Template } | { kind: "recall"; template: Template; carried: Set<string>; atRecall: string | null } | null = null;
  const closePage = (end: number): void => {
    // ^SN stripped a single-bind marker: drop this format's variables that no
    // marker in THIS page's objects points at (declarations stay).
    for (let i = variables.length - 1; i >= pg.vari; i--) {
      const v = variables[i];
      if (!v || !s.serialStrippedFns.has(v.fnNumber)) continue;
      if (s.declaredFns.has(v.fnNumber)) continue;
      const marker = markerOf(v.name);
      let used = false;
      for (let j = pg.obj; j < objects.length && !used; j++) {
        const o = objects[j];
        used = o !== undefined && (getObjectStringContent(o)?.includes(marker) ?? false);
      }
      if (!used) {
        variables.splice(i, 1);
        releaseVariableName(s, v.name);
      }
    }
    const pagePartial = [...s.result.partials.values()];
    const pageObjects = objects.slice(pg.obj);
    const pageVariables = variables.slice(pg.vari);
    const shapes = fnConsumerShapes(pageObjects, pageVariables);
    adoptFnDefaultCandidates(pageVariables, s.fnDefaultCandidates, shapes.templateFns);
    normalizeModeDDefaults(pageObjects, pageVariables, shapes.loneFns);
    if (normalizeCode128PlainDefaults(pageObjects, pageVariables, shapes))
      s.fdRegenLossy ??= REGEN_LOSSY_REASONS.code128;
    const pageIndex = pages.length;
    const findings = bucketFindings(
      pageIndex,
      pagePartial,
      browserLimit.slice(pg.browser),
      unknown.slice(pg.unknown),
      replayRisk.slice(pg.replay),
      deviceAction.slice(pg.device),
      unterminated.slice(pg.unterminated),
      hexControl.slice(pg.hexControl),
    );
    // A ^FN still open at ^XZ is raw bytes the header would re-emit as well.
    const regenLoss = regenLossReason(
      pg,
      s.declaredFns.size > 0 || s.comment.fnNumber !== null,
      s.fdRegenLossy,
    );
    const pageRegenSafe = regenLoss === undefined;
    let pageOverlay: BlockOverlay | undefined;
    // Replayed objects live in the template's bytes, so they cannot count toward this page's overlay.
    const rc = s.result.recall;
    const ownObjects = rc ? pageObjects.filter((_o, k) => k < rc.objects[0] - pg.obj || k >= rc.objects[1] - pg.obj) : pageObjects;
    if (opts.captureOverlay && ownObjects.every((o) => linkedIds.has(o.id))) {
      const frame =
        s.label.lhX !== 0 || s.label.lhY !== 0 || s.label.ltY !== 0
          ? { homeX: s.label.lhX, homeY: s.label.lhY, top: s.label.ltY }
          : undefined;
      // buildBlockOverlay throws on a broken span invariant (unreachable
      // today); catching drops the overlay instead of crashing import.
      try {
        pageOverlay = buildBlockOverlay(
          zpl.slice(pg.start, end),
          overlaySpans
            .slice(pg.span)
            .map((sp) => ({ ...sp, start: sp.start - pg.start, end: sp.end - pg.start })),
          // A dropped field's bytes would print again once the field behind them is gone.
          { regenSafe: pageRegenSafe, frame, head: pg.head, openTail: pg.openTail, droppedField: unterminated.length > pg.unterminated },
        );
      } catch (err) {
        console.warn("buildBlockOverlay failed, dropping overlay for this page", err);
        pageOverlay = undefined;
      }
    }
    // A non-regenSafe overlay replays verbatim only until the first edit;
    // surface that the byte-exact guarantee is conditional for this page.
    if (pageOverlay && regenLoss !== undefined) {
      findings.push({ kind: "lossyEdit", command: regenLoss, pageIndex });
    }
    const w = labelConfig.widthMm;
    const h = labelConfig.heightMm;
    // customFonts is document-wide and bound at the pass end, so a page carries none.
    const { customFonts: _fonts, ...pageConfig } = labelConfig;
    const page: ParsedPage = {
      objects: pageObjects,
      variables: pageVariables,
      findings,
      labelSize: { widthMm: w, heightMm: h },
      labelConfig: pageConfig,
      span: { start: pg.start, end },
    };
    if (pageOverlay) page.overlay = pageOverlay;
    if (pg.storedFormatPath !== undefined) page.storedFormatPath = pg.storedFormatPath;
    if (s.result.recallFormatPath !== undefined) page.recallFormatPath = s.result.recallFormatPath;
    if (s.result.recallFormatSpan !== undefined) page.recallFormatSpan = s.result.recallFormatSpan;
    const closing = pendingClose;
    pendingClose = null;
    if (closing?.kind === "store") closing.template.state = streamState();
    if (rc !== undefined) {
      const replayed: [number, number] = [rc.objects[0] - pg.obj, rc.objects[1] - pg.obj];
      const row = closing?.kind === "recall" ? closing : undefined;
      // A row prints the replay and nothing else: no object, finding or state of its own. A control byte in a
      // row value is the row's data, a device action prints nothing anywhere, and the edit loss is the template's.
      const ownFinding = findings.some((f) => f.kind !== "partial" && f.kind !== "hexControl" && f.kind !== "deviceAction" && f.kind !== "lossyEdit")
        || [...s.result.partials.keys()].some((key) => !row?.carried.has(key));
      const ownObject = replayed[0] !== 0 || replayed[1] !== pageObjects.length;
      // ZD230-measured: the recalled fields form under the state at ^XF, so the replay at ^XZ is
      // only true to the print while nothing behind the ^XF changed that state.
      const moved = row?.atRecall !== JSON.stringify(fieldState());
      if (pg.recallOnly && (!row || ownFinding || ownObject || moved || !stateAgrees(row.template, streamState()))) pg.recallOnly = false;
      page.recall = {
        pageIndex: rc.pageIndex,
        slotsOnly: pg.recallOnly,
        objects: replayed,
        variables: [rc.variables[0] - pg.vari, rc.variables[1] - pg.vari],
        declarations: rc.declarations,
      };
    }
    if (!s.sawXa) page.bare = true;
    if (opts.captureOverlay) {
      const spanEntries = overlaySpans.slice(pg.span).flatMap(
        (sp): [string, SourceSpan][] =>
          sp.link.kind === "object"
            ? [[sp.link.objectId, { start: sp.start, end: sp.end }]]
            : [],
      );
      if (spanEntries.length > 0) {
        page.objectSpans = new Map(spanEntries);
        const frames = spanEntries.flatMap(([id]): [string, OverlayFrame][] => {
          const frame = linkedFrames.get(id);
          return frame ? [[id, frame]] : [];
        });
        if (frames.length > 0) page.objectFrames = new Map(frames);
      }
    }
    pages.push(page);
    // ^PW/^LL persist across ^XA, so only a value CHANGE between page closes is
    // a real divergence the single-label model cannot represent.
    if (w !== undefined || h !== undefined) {
      if (
        (lastPageW !== undefined || lastPageH !== undefined) &&
        (w !== lastPageW || h !== lastPageH)
      ) {
        mixedPageGeometry = true;
      }
      lastPageW = w;
      lastPageH = h;
    }
    pg = freshPageScope(end);
    resetFormatScopedState(s);
  };

  const dispatch = ({ cmd, rest, start, end }: ZplToken): void => {
    // Read by the finding push sites (notePartial, pushBrowserLimit). End is
    // trimmed: the tokenizer's end runs to the next command's prefix, and a
    // span must not swallow the line break plus following indent.
    s.result.prevTokenEnd = s.result.tokenSpan?.end ?? 0;
    s.result.tokenSpan = { start, end: trimmedSpanEnd(zpl, start, end) };
    s.result.tokenEnd = end;
    s.result.tokenCommand = `${zpl[start]}${cmd}`;
    s.result.lastSpanByCmd.set(cmd, s.result.tokenSpan);
    // Strips trailing break plus indent from the last literal param; LITERAL_TAIL_CMDS keep real trailing spaces.
    const unwrapped = stripLineWrap(rest);
    const p = unwrapped.split(s.format.delimiterChar);
    const sourceToken = payloadSummary(s.result.tokenCommand, unwrapped);
    const last = p[p.length - 1];
    if (!LITERAL_TAIL_CMDS.has(cmd) && last !== undefined && /\S/.test(last)) {
      p[p.length - 1] = stripTrailingSpaces(last);
    }
    // Lossless replay re-emits these, so they run on the user's printer at print or export.
    const prefix = zpl[start] === s.format.tildeChar ? "~" : "^";
    const canonical = `${prefix}${cmd}`;
    const takesPrefix = commandTakesPrefix(cmd, prefix);
    // The device action quotes its payload: the report must name the bytes that will run.
    if (takesPrefix && replayRiskCodes.has(cmd)) replayRisk.push({ command: s.result.tokenCommand, span: s.result.tokenSpan });
    else if (takesPrefix && DEVICE_ACTION_IDS.has(canonical)) deviceAction.push({ command: sourceToken, span: s.result.tokenSpan });
    // Balance bookkeeping needs the token offset and the state the handler is
    // about to flip, so it sits here rather than in the two handlers.
    if (takesPrefix && (cmd === "XA" || cmd === "XZ")) {
      const cmdText = zpl.slice(start, start + 3);
      if (cmd === "XZ") {
        if (!openXa) unbalanced ??= { kind: "strayXz", at: start, cmd: cmdText };
        openXa = null;
      } else {
        // A second ^XA is itself correct; the defect is the format it
        // interrupts, so the error points at THAT opener and carries this
        // offset as the place the missing ^XZ belongs.
        if (openXa) {
          unbalanced ??= { kind: "unclosedXa", ...openXa, related: { at: start, cmd: cmdText } };
        }
        openXa = { at: start, cmd: cmdText };
      }
    }
    const handler = takesPrefix
      ? handlers[canonical] ?? (commandTwinSplit(cmd) ? undefined : handlers[cmd]) ?? wildcards.find((w) => w.matches(cmd))?.handle
      : undefined;
    if (handler) {
      // The field's object base as this token found it: a stash the closing
      // flush commits must not count as this field's own object.
      const base = s.field.objBase;
      s.reverseBgCommits = 0;
      // Read before the flush pushes the object: a bare opener at ^XZ has nothing to terminate.
      const tailHasContent = cmd === "XZ" && openTailHasContent(s);
      // Arming unconsumed at ^FS MAY ride to the next ^FD on firmware
      // (cross-^FS carry unverified; the parser drops it per the spec's
      // in-field wording), so regen must not run under it. Read pre-^FS.
      const unconsumedArm =
        cmd === "FS" && (s.field.feArmed || s.field.fcArmed) && s.field.pendingFD === null;
      const homeBefore =
        cmd === "LH" || cmd === "LT"
          ? { x: s.label.lhX, y: s.label.lhY, t: s.label.ltY }
          : null;
      handler(p, rest, cmd);
      if (cmd === "FS") s.format.inFormatHead = false;
      // Every ^JM in the head is recorded, invalid values included: export
      // rewrites the valid ones and must place a new declaration behind the
      // last of them either way.
      if (cmd === "JM" && s.format.inFormatHead && s.recall === null) {
        // trimEnd: `rest` runs to the next command, so it drags the line break
        // of multi-line ZPL into the span.
        const from = start - pg.start;
        // A ^CC/^CD inside the head retargets the prefix/value read, so each span
        // carries the caret and delimiter live at its own ^JM, not the opener's.
        pg.head.jmSpans.push({ start: from, end: from + 3 + rest.trimEnd().length, delim: s.format.delimiterChar, caret: s.format.caretChar });
      }
      if (opts.captureOverlay && s.recall === null) {
        if (
          s.format.caretChar !== "^" ||
          s.format.tildeChar !== "~" ||
          s.format.delimiterChar !== "," ||
          s.format.unitScale !== 1 ||
          // ^LR reverses every following field and is never re-emitted, so a
          // regenerated field under a surviving raw ^LR would double-reverse.
          s.label.lrActive
        ) {
          pg.regenHostileFormat = true;
        }
        // Arming is span-local only when it precedes its ^FD inside the field;
        // outside a span or after the ^FD, the surviving raw ^FE/^FC would arm
        // a neighbouring or regenerated ^FD on firmware.
        const strayArm =
          (cmd === "FE" || cmd === "FC") &&
          (pg.ovStart === null || s.field.pendingFD !== null);
        // A ^FC omitting a param inherits chars whose defining bytes a regen
        // may replace, so it is block-state-dependent even in-field.
        const inheritingFc =
          cmd === "FC" && !(p[0]?.trim() && p[1]?.trim() && p[2]?.trim());
        if (unconsumedArm || strayArm || inheritingFc) {
          pg.regenHostileFormat = true;
        }
        // A persistent definition inside a field span: regen replaces the
        // span and drops the definition a later verbatim field may consume.
        // A post-^FS ^JM is a no-op (the lookahead already applied the density),
        // so only a pre-FS in-span ^JM stays regen-hostile.
        if (
          PERSISTENT_DEF_CODES.has(cmd) &&
          pg.ovStart !== null &&
          (cmd !== "JM" || s.format.inFormatHead)
        ) {
          pg.regenHostileFormat = true;
        }
        // A home change after this page already linked fields: earlier fields
        // parsed under the old home, but regen shifts by the single end-state
        // frame, mis-placing (or dropping) a regenerated early field.
        if (
          homeBefore &&
          overlaySpans.slice(pg.span).some((sp) => sp.link.kind === "object") &&
          (s.label.lhX !== homeBefore.x ||
            s.label.lhY !== homeBefore.y ||
            s.label.ltY !== homeBefore.t)
        ) {
          pg.regenHostileFormat = true;
        }
        // Any non-UTF-8 ^CI makes regen unsafe: a regenerated field emits UTF-8
        // bytes that the surviving raw ^CI would mis-decode (the generator emits
        // ^CI28 only on the full-regen fallback, not in the overlay path).
        if (s.format.ciDecoder.encoding !== "utf-8") pg.sawNonUtf8Ci = true;
        // A token closing an open field (^FS, or ^XZ with a field open) owns
        // the object its flush pushed; a stash committed on the way is linked
        // by the commit itself and sits below that object.
        const closing = cmd === "FS" || cmd === "XZ" ? pg.ovStart : null;
        if (cmd === "BY" && pg.ovStart !== null) {
          pg.spanHasBy = true;
          // Mirrors the handler's capture: zero is no height (the session
          // value stays in charge), so it must not count as a pin.
          pg.spanByHasH ||= s.defaults.byHeight >= 1;
        }
        if (closing !== null) {
          // A field ^XZ closes owns the bytes up to the token before ^XZ, as an
          // ^FS-closed one owns everything up to its ^FS.
          const fieldEnd = cmd === "FS" ? start + 3 : s.result.prevTokenEnd;
          if (tailHasContent) pg.openTail = true;
          const ownAt = base + s.reverseBgCommits;
          const own = objects.length === ownAt + 1 ? objects[ownAt] : undefined;
          // A ^BY-consuming barcode whose ^BY sits outside its own field would
          // inherit a regenerated neighbour's inline ^BY on replay; mark the
          // block unsafe. Classify by the parsed object type (not a regex).
          // Of the 2D codes only ^FO QR consumes ^BY (its print sinks by the
          // height, ZD230-measured); DataMatrix/Aztec/MaxiCode and ^FT QR are
          // immune.
          // QR consumes only the h slot (position), so its ^BY must fill one;
          // the 1D families consume w, which every ^BY form sets.
          const hasNeededBy = own?.type === "qrcode" ? pg.spanByHasH : pg.spanHasBy;
          const consumesBy = !!own && (
            BY_CONSUMING_BARCODE_TYPES.has(own.type) ||
            (own.type === "qrcode" && own.positionType !== "FT" && !qrPrintsAsGraphic(own))
          );
          if (consumesBy && !hasNeededBy) {
            pg.sawBareBarcode = true;
          }
          if (s.reverseBg && s.reverseBg.span === undefined && objects.length === ownAt) {
            // This field stashed a reverse-bg (no object yet); record its span
            // so the box can be linked when it commits later.
            s.reverseBg.span = { start: closing, end: fieldEnd };
          } else if (own) {
            linkObject(closing, fieldEnd, own.id);
          }
          pg.ovStart = null;
        }
        if (s.field.openedAt !== null && s.field.openedAt === s.result.tokenSpan) {
          pg.ovStart = s.comment.run?.start ?? start;
          pg.ovFrame = currentFrame();
          pg.spanHasBy = false;
          pg.spanByHasH = false;
        }
      }
      // A ^FX run survives only up to the next command, and the opener has read it by
      // now. A command between a ^FX and its field leaves the ^FX raw; editing that
      // field re-emits the comment, a harmless duplicate.
      if (cmd !== "FX") s.comment.run = null;
      // Page boundary: the FIRST ^XA continues page 0 (which owns any
      // preamble); every further ^XA closes the page at its own offset, after
      // this token's capture block so a boundary-committed reverse-bg span
      // still lands in the closing page.
      if (cmd === "XA") {
        if (s.sawXa) closePage(start);
        s.sawXa = true;
        // Drops any ^JM span from a pre-^XA preamble: those sit outside the
        // head the lookahead reads, so export must not rewrite them either.
        pg.head = {
          caret: s.format.caretChar,
          at: start - pg.start + 3,
          jmSpans: [],
          dfSpans: undefined,
        };
        // Resolve this format's ^JM density up front so ^MU-scaled reads see
        // the final density; absent ^JM leaves the persistent density.
        const jm = lookaheadJmDensity(zpl, start, s.format, s.format.delimiterChar);
        if (jm) {
          s.format.jmDensity = jm;
          labelConfig.jmDensity = jm;
        }
        // Unlike ^JM, a ^DF does not persist: a block without one stores nothing.
        const df = lookaheadStoredFormat(zpl, start, s.format, s.format.delimiterChar);
        pg.storedFormatPath = df?.path;
        if (df) pg.head.dfSpans = df.spans.map((sp) => ({ ...sp, start: sp.start - pg.start, end: sp.end - pg.start }));
        s.format.unitScale = deriveUnitScale(s.format, dpmm);
      }
      return;
    }

    if (rest.trim() || cmd.trim()) {
      // Source prefix from `start`: tilde commands must not surface as `^`.
      unknown.push({ command: payloadSummary(`${zpl[start] ?? "^"}${cmd}`, rest), span: s.result.tokenSpan });
    }
    s.comment.run = null;
  };

  // The printer keeps a stored format as text and re-runs it at recall with the
  // block's ^FN data, so a recall replays the template's tokens into its own page.
  interface Template { tokens: ZplToken[]; slots: Set<number>; partialKeys: Set<string>; state?: Record<string, unknown>; decided?: boolean; pageIndex: number }
  const templates = new Map<string, Template>();
  // The persistent stream state every field forms under.
  const fieldState = (): Record<string, unknown> => {
    const { ciDecoder, caretChar, tildeChar, delimiterChar, unitScale, muMode, embedChar, clockChars } = s.format;
    return { label: { ...s.label }, defaults: { ...s.defaults }, format: { encoding: ciDecoder.encoding, caretChar, tildeChar, delimiterChar, unitScale, muMode, embedChar, clockChars: { ...clockChars } } };
  };
  // What a block leaves behind for the blocks after it: the design's document state, the font
  // alias table and the field state. A folded row must leave it as the template page did.
  const streamState = (): Record<string, unknown> => ({ ...labelConfig, ...fieldState() });
  // What the template left unset, the first row decides, the standing value included. A later row
  // that disagrees prints something other than what the design shows.
  const stateAgrees = (template: Template, now: Record<string, unknown>): boolean => {
    const fixed = template.state;
    if (!fixed) return false;
    const keys = [...new Set([...Object.keys(fixed), ...Object.keys(now)])];
    if (keys.some((key) => (template.decided || fixed[key] !== undefined) && JSON.stringify(fixed[key]) !== JSON.stringify(now[key]))) return false;
    template.state = now;
    template.decided = true;
    return true;
  };
  let blockTokens: ZplToken[] = [];
  let atRecall: string | null = null;
  const replayRecall = (): void => {
    const path = s.result.recallFormatPath;
    if (path === undefined) return;
    const ref = parseStoragePath(path);
    if (!ref) return;
    const template = recallCandidates({ ...ref, ext: ref.ext ?? "ZPL" }).map((key) => templates.get(key)).find((t) => t !== undefined);
    if (!template) return;
    // Slot declarations feed the replay. A variable bound by one of the block's own fields stays.
    const own = variables.slice(pg.vari);
    const values = new Map(own.map((v) => [v.fnNumber, v.defaultValue] as const));
    const bound = new Set(objects.slice(pg.obj).flatMap((o) => extractTemplateRefs(getObjectStringContent(o) ?? "")));
    variables.splice(pg.vari, own.length, ...own.filter((v) => bound.has(v.name)));
    for (const v of own) if (!bound.has(v.name)) releaseVariableName(s, v.name);
    const objectsFrom = objects.length;
    const variablesFrom = variables.length;
    const replayFrom = { objects: objectsFrom, variables: variablesFrom };
    // The template's findings were reported on its own page.
    const marks = { unknown: unknown.length, browser: browserLimit.length, replay: replayRisk.length, device: deviceAction.length, unterminated: unterminated.length, hexControl: hexControl.length };
    const partials = s.result.partials;
    s.result.partials = new Map();
    const replayPartials = s.result.partials;
    const { tokenSpan, tokenEnd, tokenCommand, prevTokenEnd, lastSpanByCmd } = s.result;
    s.result.lastSpanByCmd = new Map(lastSpanByCmd);
    s.recall = values;
    // The stored text starts with its own head, whose ^JM the template's lookahead already applied.
    s.format.inFormatHead = true;
    for (const token of template.tokens) dispatch(token);
    s.format.inFormatHead = false;
    // The template's ^XZ is not replayed, and it may have closed its last field or stashed a box.
    closeField();
    commitPendingReverseBg();
    s.recall = null;
    unknown.length = marks.unknown;
    browserLimit.length = marks.browser;
    replayRisk.length = marks.replay;
    deviceAction.length = marks.device;
    unterminated.length = marks.unterminated;
    // A control byte in a row value truncates that row, so its finding stays with the block.
    const rowHexControl = hexControl.slice(marks.hexControl).filter((t, i, all) => t.span !== undefined && t.span.start >= pg.start && all.findIndex((o) => o.span?.start === t.span?.start) === i);
    hexControl.length = marks.hexControl;
    hexControl.push(...rowHexControl);
    s.result.partials = partials;
    // A partial the template's own page never raised comes from the row's value.
    const carried = new Set<string>();
    for (const [key, note] of replayPartials) {
      if (template.partialKeys.has(key) || partials.has(key)) continue;
      partials.set(key, note);
      carried.add(key);
    }
    Object.assign(s.result, { tokenSpan, tokenEnd, tokenCommand, prevTokenEnd, lastSpanByCmd });
    // A slot the template reaches only through an embed keeps the block's bytes.
    const replayed = variables.slice(replayFrom.variables);
    for (const v of replayed) if (v.defaultValue === "") v.defaultValue = values.get(v.fnNumber) ?? "";
    const consumed = new Set(replayed.map((v) => v.fnNumber));
    for (const v of own) {
      if (bound.has(v.name) || consumed.has(v.fnNumber)) continue;
      // The format names the slot but fills nothing, so the block's declaration stays, renamed if the replay took its name.
      if (template.slots.has(v.fnNumber)) {
        v.name = claimVariableName(s, v.name);
        variables.push(v);
        continue;
      }
      // ZD230-measured: a slot the format never names prints as a stray field, which no page can show.
      notePartial(s.result, `^FN${v.fnNumber}`, "recallSlot");
    }
    // Stream state that persists across blocks, such as ^MU, ^BY, ^CF or ^LH, shapes every replayed field.
    // Only a replay that prints as the template page did is a plain row of it.
    const replayedObjects = objects.slice(replayFrom.objects);
    // The stored text starts after ^DF, so the replay pairs with the template page's last objects.
    const stored = pages[template.pageIndex]?.objects ?? [];
    const asStored = stored.slice(stored.length - replayedObjects.length);
    const shape = (o: LabelObject): string => printShape(o, s.anchorById.get(o.id));
    if (asStored.length !== replayedObjects.length || replayedObjects.some((o, k) => shape(o) !== shape(asStored[k] as LabelObject))) pg.recallOnly = false;
    pendingClose = { kind: "recall", template, carried, atRecall };
    s.result.recall = {
      pageIndex: template.pageIndex,
      objects: [replayFrom.objects, objects.length],
      variables: [replayFrom.variables, variables.length],
      declarations: own.filter((v) => !bound.has(v.name)),
    };
  };

  // Wrapped in a call, since flow narrowing cannot see the dispatch closure reassign openXa.
  const openFormat = (): { at: number; cmd: string } | null => openXa;
  for (const token of tokens) {
    const wasOpen = openFormat() !== null;
    dispatch(token);
    const open = openFormat();
    if (open !== null && open.at === token.start) {
      blockTokens = [];
      atRecall = null;
      pg.recallOnly = true;
    } else if (open !== null) {
      blockTokens.push(token);
      if (token.cmd === "XF") atRecall ??= JSON.stringify(fieldState());
    } else if (wasOpen) {
      // A block that stores a format prints nothing, its own ^XF included.
      if (pg.storedFormatPath !== undefined) {
        // Only what follows ^DF is stored, so the head before it is the block's own.
        const tokens = blockTokens.slice(blockTokens.findIndex((t) => t.cmd === "DF") + 1);
        const slots = new Set(tokens.filter((t) => t.cmd === "FN").map((t) => parseInt(t.rest, 10)).filter((n) => Number.isFinite(n)));
        const template: Template = { tokens, slots, partialKeys: new Set(s.result.partials.keys()), pageIndex: pages.length };
        templates.set(storageKey(pg.storedFormatPath), template);
        pendingClose = { kind: "store", template };
      } else replayRecall();
    }
  }

  // Close the last page (also the only one for single-block or bare streams);
  // its serial-orphan sweep runs inside.
  closePage(zpl.length);
  const stillOpen = openFormat();
  if (stillOpen) unbalanced ??= { kind: "unclosedXa", ...stillOpen };

  // Apply the geometry sidecar last so it wins over ^PW/^LL-derived mm and
  // restores dpmm, which plain ZPL can't carry.
  if (labelMeta.value) {
    labelConfig.dpmm = labelMeta.value.dpmm;
    labelConfig.widthMm = labelMeta.value.widthMm;
    labelConfig.heightMm = labelMeta.value.heightMm;
  }

  const liveFontPaths = resolveLiveFonts(s);
  const bound = bindFontEmbeds(labelConfig.customFonts, liveFontPaths);
  if (bound.fonts) labelConfig.customFonts = bound.fonts;
  const embeddedFontPaths = bound.embedded;

  return {
    pages,
    mixedPageGeometry,
    unbalanced,
    labelConfig,
    printerProfile,
    decodedImages: s.result.decodedImages,
    uploadedFontPaths: liveFontPaths,
    embeddedFontPaths,
    fontLosses: [...s.fonts.fontLosses],
    uploadedGraphics: [...s.fonts.downloadedGraphics].map(([path, g]) => ({ path, gfa: g.gfaCache, via: g.via })),
    sourceFnNumbers: s.result.sourceFnNumbers,
  };
}
