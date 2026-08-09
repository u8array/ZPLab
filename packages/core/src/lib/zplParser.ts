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
import { stripLineWrap, stripTrailingSpaces, tokenize } from "./zplParser/helpers";
import { lookaheadJmDensity, scanBareStream } from "./zplHeadScan";
import { createParserState, deriveUnitScale, resetFormatScopedState, type FnDefaultCandidate } from "./zplParser/context";
import { createFlushField } from "./zplParser/flushField";
import { createBarcodeHandlers } from "./zplParser/handlers/barcodes";
import { createDynamicFontAWildcard, createFieldHandlers } from "./zplParser/handlers/fields";
import { createGraphicsHandlers } from "./zplParser/handlers/graphics";
import { createLabelConfigHandlers } from "./zplParser/handlers/labelConfig";
import { createSetupScriptHandlers } from "./zplParser/handlers/setupScript";
import { createUnitsHandler } from "./zplParser/handlers/units";
import { createUnsupportedHandlers } from "./zplParser/handlers/unsupported";
import { buildBlockOverlay, type BlockOverlay, type FormatHead, type JmSpan, type LinkedSpan } from "./zplOverlay/overlay";
import type {
  Handler,
  ImportFinding,
  ParsedPage,
  ParsedZPL,
  Wildcard,
} from "./zplParser/types";
export type {
  ImportFindingKind,
  ImportFinding,
  ImportReport,
  ParsedPage,
  ParsedZPL,
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

/** Commands defining persistent state a later field may consume implicitly;
 *  in-span they make single-field regen unsafe (the span replace drops the
 *  definition). ^BY absent: consumers self-flag via sawBareBarcode; ^JM is
 *  legal pre-^FS, so it can sit in a field span too. */
const PERSISTENT_DEF_CODES = new Set(["CF", "FW", "CW", "SO", "LH", "LT", "JM"]);

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
  // partialCmds stays behind s.result: the Set is swapped at each page close
  // so per-format repeats of a command are re-reported on their own page.
  const {
    objects, labelConfig, printerProfile, variables,
    browserLimit, unknown, replayRisk, deviceAction,
  } = s.result;

  const takeComment = (): string | undefined => {
    const c = s.comment.pending;
    s.comment.pending = undefined;
    return c;
  };

  const graphicsFamily = createGraphicsHandlers(s, takeComment);
  const { commitPendingReverseBg, getReverseFlag } = graphicsFamily.helpers;
  const flushField = createFlushField(s, {
    commitPendingReverseBg,
    getReverseFlag,
    takeComment,
  });

  const resetComment: Handler = (_, rest) => {
    s.comment.pending = rest.trim() || undefined;
  };
  // Our geometry sidecar, consumed (not shown as an object comment) only while
  // no design object was seen, so a body ^FX can't rewrite the label settings.
  // Deliberately document-wide, not page-0: a verbatim settings-only block
  // precedes the regenerated design block (and its sidecar) on re-export.
  // Holder object so the closure write survives TS flow narrowing.
  const labelMeta: { value: LabelMeta | null } = { value: null };
  // Multi-line ^FX before a field accumulate; XA/XZ reset at label boundaries.
  const appendComment: Handler = (_, rest) => {
    const next = rest.trim();
    if (!next) return;
    if (!labelMeta.value && objects.length === 0) {
      const meta = parseLabelMetaComment(next);
      if (meta) {
        labelMeta.value = meta;
        return;
      }
    }
    s.comment.pending = s.comment.pending ? `${s.comment.pending}\n${next}` : next;
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
      commitPendingReverseBg();
      // Between formats there is no head: a ^JM out here is neither read by the
      // next format's lookahead nor rewritable, so it must not be taken for one.
      s.format.inFormatHead = false;
      resetComment(p, rest, cmd);
    },
  };

  Object.assign(handlers, createBarcodeHandlers(s));
  Object.assign(handlers, createFieldHandlers(s, { flushField, appendComment }));
  Object.assign(handlers, graphicsFamily.handlers);
  const setupScriptHandlers = createSetupScriptHandlers(s);
  // Setup-Script codes are profile-backed (routable on import); device actions
  // are not, hence a separate finding kind, listed explicitly because their
  // noop handlers mix with design noops (^FM). Label settings (^MD/^PR/…) and
  // ^DY font uploads are intentionally not flagged.
  const replayRiskCodes = new Set(Object.keys(setupScriptHandlers));
  const deviceActionCodes = new Set([
    "JA", "JC", "JD", "JE", "JI", "JR",
  ]);
  // ^PH/^PP are modelled per-format settings, but their tilde twins are
  // immediate device controls; the handler map keys have no prefix, so the
  // split happens at dispatch via the token's source char. ~JM is not a real
  // command (only caret ^JM sets density), so it routes here as a noop too.
  const tildeDeviceCodes = new Set(["PH", "PP", "JM"]);
  // Commands whose last param is literal data, where a trailing space is real (^SN, ^SF, ^A@), not line-wrap noise.
  const LITERAL_TAIL_CMDS = new Set(["SN", "SF", "A@"]);
  Object.assign(handlers, setupScriptHandlers);
  Object.assign(handlers, createLabelConfigHandlers(s, dpmm));
  Object.assign(handlers, createUnitsHandler(s, dpmm));
  Object.assign(handlers, createUnsupportedHandlers(s.result));

  // Wildcard handlers are tried only after exact-match dispatch fails,
  // so a handler-table entry always wins over a pattern-match.
  const wildcards: Wildcard[] = [createDynamicFontAWildcard(s)];

  const overlaySpans: LinkedSpan[] = [];
  const linkedIds = new Set<string>();
  const linkObject = (start: number, end: number, objectId: string) => {
    overlaySpans.push({ start, end, link: { kind: "object", objectId } });
    linkedIds.add(objectId);
  };

  // Page bookkeeping: one page per ^XA block, closed at the NEXT ^XA (so the
  // inter-block separator stays with the preceding page, which the overlay
  // replay relies on). Page 0 opens at offset 0 and owns any preamble.
  const pages: ParsedPage[] = [];
  let mixedPageGeometry = false;
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
    span: overlaySpans.length,
    // Open field's source start (^FO/^FT or its leading ^FX run) and object
    // count at open; a mid-field reverse-bg commit bumps `ovBase`. Only clean
    // single-object fields and deferred reverse-bg boxes link; anything else
    // trips the all-linked gate and the block regenerates.
    ovStart: null as number | null,
    ovBase: 0,
    // Start of a contiguous ^FX run immediately before a field, so the
    // field's span owns its comment bytes.
    commentStart: null as number | null,
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
    } satisfies FormatHead,
    sawNonUtf8Ci: false,
    sawBareBarcode: false,
    sawFnDeclaration: false,
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

  const bucketFindings = (
    pageIndex: number,
    partial: readonly string[],
    browser: readonly string[],
    unk: readonly string[],
    replay: readonly string[],
    device: readonly string[],
  ): ImportFinding[] => [
    ...partial.map((command): ImportFinding => ({ kind: "partial", command, pageIndex })),
    ...browser.map((command): ImportFinding => ({ kind: "browserLimit", command, pageIndex })),
    ...unk.map((command): ImportFinding => ({ kind: "unknown", command, pageIndex })),
    ...replay.map((command): ImportFinding => ({ kind: "replayRisk", command, pageIndex })),
    ...device.map((command): ImportFinding => ({ kind: "deviceAction", command, pageIndex })),
  ];

  /** Close the current page at source offset `end`: per-format serial-orphan
   *  sweep, per-page findings/overlay, then reset the format-scoped state so
   *  the next page starts clean (printer-persistent state carries on). */
  const closePage = (end: number): void => {
    // ^SN stripped a single-bind marker: drop this format's variables that no
    // marker in THIS page's objects points at (bare ^FN declarations stay).
    for (let i = variables.length - 1; i >= pg.vari; i--) {
      const v = variables[i];
      if (!v || !s.serialStrippedFns.has(v.fnNumber)) continue;
      if (s.bareDeclaredFns.has(v.fnNumber)) continue;
      const marker = markerOf(v.name);
      let used = false;
      for (let j = pg.obj; j < objects.length && !used; j++) {
        const o = objects[j];
        used = o !== undefined && (getObjectStringContent(o)?.includes(marker) ?? false);
      }
      if (!used) variables.splice(i, 1);
    }
    const pagePartial = [...s.result.partialCmds];
    const pageObjects = objects.slice(pg.obj);
    const pageVariables = variables.slice(pg.vari);
    const shapes = fnConsumerShapes(pageObjects, pageVariables);
    adoptFnDefaultCandidates(pageVariables, s.fnDefaultCandidates, shapes.templateFns);
    normalizeModeDDefaults(pageObjects, pageVariables, shapes.loneFns);
    if (normalizeCode128PlainDefaults(pageObjects, pageVariables, shapes)) s.bcFdRegenLossy = true;
    const pageIndex = pages.length;
    const findings = bucketFindings(
      pageIndex,
      pagePartial,
      browserLimit.slice(pg.browser),
      unknown.slice(pg.unknown),
      replayRisk.slice(pg.replay),
      deviceAction.slice(pg.device),
    );
    const pageRegenSafe =
      !pg.regenHostileFormat && !pg.sawNonUtf8Ci && !pg.sawBareBarcode && !pg.sawFnDeclaration &&
      !s.bcFdRegenLossy;
    let pageOverlay: BlockOverlay | undefined;
    if (opts.captureOverlay && pageObjects.every((o) => linkedIds.has(o.id))) {
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
          { regenSafe: pageRegenSafe, frame, head: pg.head },
        );
      } catch (err) {
        console.warn("buildBlockOverlay failed, dropping overlay for this page", err);
        pageOverlay = undefined;
      }
    }
    // A non-regenSafe overlay replays verbatim only until the first edit;
    // surface that the byte-exact guarantee is conditional for this page.
    if (pageOverlay && !pageRegenSafe) {
      const reason = pg.sawNonUtf8Ci
        ? "a non-UTF-8 ^CI encoding"
        : pg.sawBareBarcode
          ? "a barcode without an explicit ^BY"
          : pg.sawFnDeclaration
            ? "a standalone ^FN declaration"
            : s.bcFdRegenLossy
              ? "a Code 128 escape stream the export re-escapes"
              : "a non-default format state (prefix, delimiter, unit, out-of-field ^FE/^FC, or ^LR)";
      findings.push({ kind: "lossyEdit", command: reason, pageIndex });
    }
    const w = labelConfig.widthMm;
    const h = labelConfig.heightMm;
    const page: ParsedPage = {
      objects: pageObjects,
      variables: pageVariables,
      findings,
      labelSize: { widthMm: w, heightMm: h },
      labelConfig: { ...labelConfig },
    };
    if (pageOverlay) page.overlay = pageOverlay;
    if (!s.sawXa) page.bare = true;
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

  for (const { cmd, rest, start } of tokens) {
    // Strips trailing break plus indent from the last literal param; LITERAL_TAIL_CMDS keep real trailing spaces.
    const p = stripLineWrap(rest).split(s.format.delimiterChar);
    const last = p[p.length - 1];
    if (!LITERAL_TAIL_CMDS.has(cmd) && last !== undefined && /\S/.test(last)) {
      p[p.length - 1] = stripTrailingSpaces(last);
    }
    // Flag printer-config commands: lossless replay re-emits them, so they run
    // on the user's printer at print/export. Recorded by code (deduped later).
    // ~PH/~PP: flagged as device actions AND skipped entirely, or they would
    // fall through to the unknown bucket and surface twice in the summary.
    if (tildeDeviceCodes.has(cmd) && zpl[start] === s.format.tildeChar) {
      deviceAction.push(`~${cmd}`);
      continue;
    }
    if (replayRiskCodes.has(cmd)) replayRisk.push(`^${cmd}`);
    else if (deviceActionCodes.has(cmd)) deviceAction.push(`^${cmd}`);
    const handler = handlers[cmd] ?? wildcards.find((w) => w.matches(cmd))?.handle;
    if (handler) {
      const reverseBefore = s.reverseBg;
      const beforeLen = objects.length;
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
      if (cmd === "JM" && s.format.inFormatHead) {
        // trimEnd: `rest` runs to the next command, so it drags the line break
        // of multi-line ZPL into the span.
        const from = start - pg.start;
        // A ^CC/^CD inside the head retargets the prefix/value read, so each span
        // carries the caret and delimiter live at its own ^JM, not the opener's.
        pg.head.jmSpans.push({ start: from, end: from + 3 + rest.trimEnd().length, delim: s.format.delimiterChar, caret: s.format.caretChar });
      }
      if (opts.captureOverlay) {
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
          overlaySpans.length > pg.span &&
          (s.label.lhX !== homeBefore.x ||
            s.label.lhY !== homeBefore.y ||
            s.label.ltY !== homeBefore.t)
        ) {
          pg.regenHostileFormat = true;
        }
        // Any non-UTF-8 ^CI makes regen unsafe: a regenerated field emits UTF-8
        // bytes that the surviving raw ^CI would mis-decode (the generator emits
        // ^CI28 only on the full-regen fallback, not in the overlay path).
        if (s.format.fhDecoder.encoding !== "utf-8") pg.sawNonUtf8Ci = true;
        // A bare ^FN declaration (^FN outside an ^FO…^FS field) becomes a raw
        // segment; the scoped header would re-emit it on regen and duplicate it.
        if (cmd === "FN" && pg.ovStart === null) pg.sawFnDeclaration = true;
        // Track the leading-comment run; a non-^FX command (other than the field
        // opener) breaks contiguity so the span won't swallow intervening config.
        // Known limitation: when a command separates a ^FX from its field, the
        // ^FX stays in a raw segment; editing that field re-emits the comment,
        // producing a duplicate ^FX in the output. Harmless (comments do not
        // print) and rare, so accepted rather than tracked per-object.
        if (cmd === "FX") {
          if (pg.commentStart === null) pg.commentStart = start;
        } else if (cmd !== "FO" && cmd !== "FT") {
          pg.commentStart = null;
        }
        // A prior stashed reverse-bg committed standalone on this (non-^FS)
        // token (graphics command, ^XA/^XZ): commitPendingReverseBg pushes the
        // box first, so objects[beforeLen] is it. ^FS is handled below instead.
        if (
          cmd !== "FS" &&
          reverseBefore?.span &&
          s.reverseBg !== reverseBefore &&
          objects.length > beforeLen
        ) {
          const box = objects[beforeLen];
          if (box) linkObject(reverseBefore.span.start, reverseBefore.span.end, box.id);
          if (pg.ovStart !== null) pg.ovBase++;
        }
        if (cmd === "FO" || cmd === "FT") {
          pg.ovStart = pg.commentStart ?? start;
          pg.ovBase = objects.length;
          pg.commentStart = null;
        } else if (cmd === "FS" && pg.ovStart !== null) {
          const fieldEnd = start + 3;
          // A ^BY-consuming barcode whose ^BY sits outside its own field would
          // inherit a regenerated neighbour's inline ^BY on replay; mark the
          // block unsafe. Classify by the parsed object type (not a regex) so
          // 2D codes that ignore ^BY (QR/DataMatrix/Aztec/MaxiCode) stay
          // regenSafe. The field's own object is the last one pushed.
          const own = objects.length > pg.ovBase ? objects[objects.length - 1] : undefined;
          if (
            own &&
            BY_CONSUMING_BARCODE_TYPES.has(own.type) &&
            !/\^BY/i.test(zpl.slice(pg.ovStart, fieldEnd))
          ) {
            pg.sawBareBarcode = true;
          }
          if (s.reverseBg && s.reverseBg.span === undefined && objects.length === pg.ovBase) {
            // This field stashed a reverse-bg (no object yet); record its span
            // so the box can be linked when it commits later.
            s.reverseBg.span = { start: pg.ovStart, end: fieldEnd };
          } else if (reverseBefore?.span && s.reverseBg === null && objects.length === pg.ovBase + 2) {
            // Stashed box committed standalone during this flush (box at pg.ovBase),
            // then the field's own object (text/barcode) at pg.ovBase+1.
            const box = objects[pg.ovBase];
            const own = objects[pg.ovBase + 1];
            if (box) linkObject(reverseBefore.span.start, reverseBefore.span.end, box.id);
            if (own) linkObject(pg.ovStart, fieldEnd, own.id);
          } else if (objects.length === pg.ovBase + 1) {
            // Clean single-object field.
            const obj = objects[pg.ovBase];
            if (obj) linkObject(pg.ovStart, fieldEnd, obj.id);
          }
          pg.ovStart = null;
        }
      }
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
        };
        // Resolve this format's ^JM density up front so ^MU-scaled reads see
        // the final density; absent ^JM leaves the persistent density.
        const jm = lookaheadJmDensity(zpl, start, s.format, s.format.delimiterChar);
        if (jm) {
          s.format.jmDensity = jm;
          labelConfig.jmDensity = jm;
        }
        s.format.unitScale = deriveUnitScale(s.format, dpmm);
      }
      continue;
    }

    if (rest.trim() || cmd.trim()) {
      // Source prefix from `start`: tilde commands must not surface as `^`.
      // trimEnd: `rest` runs to the next command, dragging the line break in
      // multi-line ZPL into the surfaced token.
      const token = `${zpl[start] ?? "^"}${cmd}${rest}`.trimEnd();
      unknown.push(token);
    }
  }

  // Close the last page (also the only one for single-block or bare streams);
  // its serial-orphan sweep runs inside.
  closePage(zpl.length);

  // Apply the geometry sidecar last so it wins over ^PW/^LL-derived mm and
  // restores dpmm, which plain ZPL can't carry.
  if (labelMeta.value) {
    labelConfig.dpmm = labelMeta.value.dpmm;
    labelConfig.widthMm = labelMeta.value.widthMm;
    labelConfig.heightMm = labelMeta.value.heightMm;
  }

  return {
    pages,
    mixedPageGeometry,
    labelConfig,
    printerProfile,
    uploadedFontPaths: [...s.fonts.downloadedFontPaths],
    referencedFontPaths: [...s.fonts.referencedFontPaths],
    sourceFnNumbers: s.result.sourceFnNumbers,
  };
}
