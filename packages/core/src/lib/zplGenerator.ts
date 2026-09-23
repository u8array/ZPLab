import { mmToDots } from './coordinates';
import { CONTROL_BYTES_RE } from './binaryText';
import { unsafeRawFieldSpans } from './zplParser/helpers';
import { rewriteRawFieldSpans } from './zplParser/decoders/gfa';
import { getEntry, usesPlainCode128Escape, BARCODE_1D_TYPES } from '../registry';
import { fdField, stripZplCommandChars, GRAPHIC_ANCHOR_TYPES, printerAnchoredX } from '../registry/zplHelpers';
import { stripZplParamChars } from './zplParams';
import { isRecallableFormatPath, storageKey, storageRefMatchesPath } from './storagePath';
import {
  extractTemplateRefs,
  hasTemplateMarkers,
  pickEmbedChar,
} from './fnTemplate';
import { hasClockMarkers, pickClockChars } from './fcTemplate';
import { boundColumnIndex, getObjectStringContent } from './variableBinding';
import { classifyField } from './variableField';
import { escapeGs1FdValue } from './gs1';
import { fnConsumerBuckets } from './gs1ModeDFns';
import { planCode128Fd } from './code128Plan';
import { resolveControlMarkers } from '../types/controlKey';
import { resolveContentPreview } from './markerResolve';
import { formatLabelMetaComment, labelMetaOf } from './zplLabelMeta';
import { designAsPageLabel, jmDensityOf } from '../types/LabelConfig';
import type { ClockOffset, CustomFontMapping, JmDensity, LabelConfig, PageLabel } from '../types/LabelConfig';
import type { ZplEmitContext } from '../types/ZplEmit';
import type { Variable } from '../types/Variable';
import { exportableLeaves, isGroup, pageLabelConfig, type LabelObject, type LeafObject, type Page } from '../types/Group';
import { isOverlayConsistent, MIN_DF_SPAN, MIN_JM_SPAN, type DfSpan, type FormatHead, type JmSpan, type OverlayFrame, type UploadSegment } from './zplOverlay/overlay';
import type { SourceSpan } from './zplParser/types';
import { reconstructBlockHead, storedFormatSpanOf } from './zplHeadScan';
import { objectBoundsDots, qrPrintsAsGraphic, type ObjectBoundsCtx } from './objectBounds';
import { formatFontDownloadFromPath } from './customFonts';
import { graphicUploadLine, imageEmitDims, storedGraphicShips, uploadKey, type ImageProps } from '../registry/image';

function formatDownloadObject(m: CustomFontMapping): string | undefined {
  if (!m.embedInZpl || !m.path) return undefined;
  return formatFontDownloadFromPath(m.path);
}

/** Render a leaf to its field bytes, prefixed with its ^FX comment when set.
 *  Shared by the model generator and the overlay regeneration path so the two
 *  never drift on comment handling. */
function emitFieldBody(obj: LeafObject, emitCtx: ZplEmitContext): string {
  const zpl = getEntry(obj.type)?.toZPL(obj, emitCtx) ?? '';
  return obj.comment ? `^FX${stripZplCommandChars(obj.comment)}\n${zpl}` : zpl;
}

/** ^FO x/y maximum (spec p. 201). */
const FO_MAX = 32000;
const ZERO_FRAME: OverlayFrame = { homeX: 0, homeY: 0, top: 0 };

/** An unpositioned ^FN declaration prints as a stray field at the origin (ZD230), so it
 *  parks at the farthest point ^FO can address and still supplies the ^FE default. What the
 *  printer adds (^LH, ^LT) or rescales (^MU) is taken out; ^LS pulls x back only, so y parks too. */
function fnDeclarationOrigin(label: LabelConfig, frame: OverlayFrame = ZERO_FRAME): string {
  const mu = label.muResampling;
  const ratio = mu ? mu.outputDpi / mu.formatDpi : 1;
  const far = Math.min(FO_MAX, Math.floor(FO_MAX / ratio));
  const park = (n: number): number => Math.min(FO_MAX, Math.max(0, n));
  return `^FO${park(far - frame.homeX)},${park(far - frame.homeY - frame.top)}`;
}

/** Plan header `^FN` declarations (+ `^SO` clock offsets) for inline-embed
 *  templates, plus the emit context. embedChar is only set when a safe char
 *  exists, which fdFieldFor uses as the "templates allowed" gate. Firmware
 *  honours ^FE/^FC only per ^FD, so fdFieldFor arms them on each consuming
 *  field; unarmed fields (and the ^FN defaults) stay literal on both sides. */
export function planTemplateHeader(
  shifted: LabelObject[],
  label: LabelConfig,
  variables: readonly Variable[],
  frame: OverlayFrame | undefined,
  bareFnSlots?: ReadonlySet<number>,
): { headerLines: string[]; emitCtx: ZplEmitContext } {
  const origin = fnDeclarationOrigin(label, frame);
  // O(N+V) vs O(N*V) per-marker re-scan.
  const varsByName = new Map(variables.map((v) => [v.name, v]));
  const buckets = fnConsumerBuckets(shifted, variables);
  const modeDFns = buckets.modeDExclusive;
  const plain128Fns = buckets.plainExclusive;
  const plainSharedFns = buckets.plainShared;

  const templatePayloads: string[] = [];
  const clockPayloads: string[] = [];
  // Referenced Variable per fn, so the header declares exactly what this
  // page's templates use.
  const templateVarsByFn = new Map<number, Variable>();
  const singleBindFns = new Set<number>();
  // Group exclusion cascades: a hidden single-bind must not suppress the
  // header default its visible template co-consumer depends on.
  for (const leaf of exportableLeaves(shifted)) {
    const c = getObjectStringContent(leaf);
    if (c === undefined) continue;
    // Content == exactly one known marker is single-bind: emitted inline as
    // ^FN by fdFieldFor, so it must NOT also be declared in the header block.
    const cls = classifyField(c, variables);
    if (cls.kind === "single") {
      singleBindFns.add(cls.variable.fnNumber);
      continue;
    }
    // Scan the payload as it will be EMITTED: the plain-^BC escape injects
    // '0'/'<'/'=' after this scan, and '<'/'=' are ^FC candidate chars.
    const leafEntry = getEntry(leaf.type);
    const scan =
      usesPlainCode128Escape(leafEntry, (leaf as { props?: object }).props)
        ? planCode128Fd(c, 'template').fd
        : c;
    // Chips-only payloads arm no ^FE (they emit as invocations/bytes), so
    // their literals must not constrain the embed-char pick.
    if (hasTemplateMarkers(resolveControlMarkers(c))) {
      templatePayloads.push(scan);
      for (const name of extractTemplateRefs(c)) {
        const v = varsByName.get(name);
        if (v) templateVarsByFn.set(v.fnNumber, v);
      }
    }
    if (hasClockMarkers(c)) clockPayloads.push(scan);
  }
  // FN-definition lines and their defaults never arm ^FE (firmware honours it
  // only for the next ^FD), so only the armed template payloads need the scan.
  const pickedEmbedChar =
    templatePayloads.length > 0 ? pickEmbedChar(templatePayloads) : '#';
  const headerLines: string[] = [];
  const emitCtx: ZplEmitContext = { label, variables };
  if (plainSharedFns.size > 0) emitCtx.rawFdFns = plainSharedFns;
  if (bareFnSlots && bareFnSlots.size > 0) emitCtx.bareFnSlots = bareFnSlots;

  if (pickedEmbedChar !== null) {
    for (const [fn, v] of [...templateVarsByFn].sort(([a], [b]) => a - b)) {
      if (singleBindFns.has(fn)) continue;
      // A recall-supplied slot still needs a field to land in; a ^FD here would seal it against the recall (ZD230).
      if (emitCtx.bareFnSlots?.has(fn)) {
        headerLines.push(`${origin}^FN${fn}^FS`);
        continue;
      }
      // Mode-D-exclusive slot: > needs its >0 invocation (parser reverses).
      // Plain-^BC-exclusive slot likewise: >/^/~ need their invocation
      // literals; the ^FH hex fdField would otherwise use is dropped from
      // the symbol.
      const def = modeDFns.has(fn)
        ? escapeGs1FdValue(v.defaultValue)
        : plain128Fns.has(fn)
          ? planCode128Fd(v.defaultValue, 'templateValue').fd
          : v.defaultValue;
      headerLines.push(`${origin}^FN${fn}${fdField(def)}`);
    }
    emitCtx.embedChar = pickedEmbedChar;
  }

  if (clockPayloads.length > 0) {
    const picked = pickClockChars(clockPayloads);
    if (picked) {
      // ^SO precedes the per-field ^FC armings so the offsets are set when
      // the firmware activates the secondary/tertiary clock chars. ^SO is
      // session-scoped; emitting on every label that uses these channels
      // overwrites any stale state from a prior label.
      const so2 = formatSetOffset(2, label.secondaryClockOffset);
      const so3 = formatSetOffset(3, label.tertiaryClockOffset);
      if (so2) headerLines.push(so2);
      if (so3) headerLines.push(so3);
      emitCtx.clockChars = picked;
    }
  }

  return { headerLines, emitCtx };
}

/** ^SOa,b,c,d,e,f,g where a=clock# (2 or 3), then wire order
 *  months,days,years,hours,minutes,seconds. Returns null when the
 *  offset is absent or all-zero (in which case the channel falls
 *  back to the primary RTC and the command is redundant). */
function formatSetOffset(
  clock: 2 | 3,
  offset: ClockOffset | undefined,
): string | null {
  if (!offset) return null;
  const slots = [
    offset.months ?? 0,
    offset.days ?? 0,
    offset.years ?? 0,
    offset.hours ?? 0,
    offset.minutes ?? 0,
    offset.seconds ?? 0,
  ];
  if (slots.every((v) => v === 0)) return null;
  return `^SO${clock},${slots.join(',')}`;
}

/** Head-less replay block, once a density decision is due: self-declares
 *  target -> keep, latch wire; contradiction, or due with no self-declaration
 *  -> regenerate; nothing due (target === wire) -> replay as-is. */
function headlessAction(
  selfDeclared: JmDensity | undefined,
  target: JmDensity,
  wireJm: JmDensity | undefined,
): 'keep' | 'regenerate' | 'replay' {
  if (selfDeclared === target) return 'keep';
  return selfDeclared !== undefined || target !== wireJm ? 'regenerate' : 'replay';
}

/** Each page becomes its own ^XA..^XZ block (separate labels to the printer).
 *  A page imported with a source-patch overlay replays its original bytes
 *  verbatim except for edited/added/removed objects; everything else
 *  regenerates from the model. Any inconsistency falls back to regeneration. */
export function generateMultiPageZPL(
  label: LabelConfig,
  pages: Page[],
  variables: readonly Variable[] = [],
): string {
  return generateMultiPageZplWithMap(label, pages, variables).text;
}

/** Document-absolute [start, end) of one leaf's emitted bytes: `text.slice(start, end)`
 *  is exactly what the export carries for that object (its ^FX comment included). */
export interface EmitSpan {
  pageIndex: number;
  objectId: string;
  start: number;
  end: number;
}

/** The export text plus one span per emitted leaf and one block range per page, from
 *  the same emit walk (never a re-parse). Spans are ascending and non-overlapping;
 *  hidden/excluded/dropped leaves have none. */
export function generateMultiPageZplWithMap(
  label: LabelConfig,
  pages: Page[],
  variables: readonly Variable[] = [],
): { text: string; spans: EmitSpan[]; blocks: SourceSpan[] } {
  let out = '';
  const spans: EmitSpan[] = [];
  const blocks: SourceSpan[] = [];
  // ^JM persists on the wire, so a block only declares a density the preceding
  // blocks didn't set. `undefined` means nothing declared one yet, so a block
  // inheriting its ^JM from outside this export gets the declaration back.
  let wireJm: JmDensity | undefined;
  const ledger = uploadLedger(pages);
  const shippedFonts = new Set<string>();
  pages.forEach((p, pageIndex) => {
    const pageLabel = pageLabelConfig(label, p);
    const carried = new Set((p.overlay?.segments ?? []).flatMap((seg) => (seg.kind === 'upload' ? [seg.key] : [])));
    const policy = ledger.policyFor(carried);
    const regenPage = () => generateZplBlock(pageLabel, p.objects, variables, undefined, policy.omit, shippedFonts);
    let emitted: PageBlock;
    try {
      emitted = emitPageBlock(pageLabel, p, variables, policy, shippedFonts);
    } catch (err) {
      // A throw here is an unexpected bug, not an expected inconsistency (those
      // are handled internally); warn instead of failing silently, then regenerate.
      console.warn('emitPageBlock failed, regenerating page from model', err);
      emitted = regenPage();
    }
    // Unset means full density, so a page after a ^JMB page resets the wire;
    // while nothing is declared yet there is nothing to reset.
    const target = pageLabel.jmDensity ?? (wireJm ? 'A' : undefined);
    // A replayed block whose head the parser never recorded (or whose bytes
    // moved) has no place to splice a declaration; a density-only scan of its
    // bytes (cold path) decides instead of always regenerating.
    if (!emitted.head) {
      const cold = reconstructBlockHead(emitted.block);
      const action = target === undefined ? 'keep' : headlessAction(cold.density, target, wireJm);
      // Bytes that disagree on the ^DF regenerate too: there is no head to splice.
      if (action === 'regenerate' || cold.storedFormat?.path !== pageLabel.storedFormatPath) {
        emitted = regenPage();
      } else if (action === 'keep' && target !== undefined) {
        // applyJmDensity can't read a head-less block, so latch the wire here.
        wireJm = target;
      }
    }
    const stored = applyStoredFormat(emitted, pageLabel.storedFormatPath);
    emitted = { ...emitted, block: stored.block, head: stored.head };
    const applied = applyJmDensity(emitted, pageLabel.jmDensity, target === wireJm ? undefined : target);
    const block = applied.block;
    // Track what the block actually carries, not the intent: an unreachable
    // head would leave the next block believing a density the wire never got.
    wireJm = applied.wireJm ?? wireJm;
    // An overlay page already carries the inter-block separator captured at
    // import (the splitter folds it into the preceding block). Only insert a
    // newline when the previous block didn't end with one (a fresh or
    // fallback page), so multi-page round-trips stay byte-identical and stable.
    if (out.length > 0 && !out.endsWith('\n')) out += '\n';
    const base = out.length;
    const sep = block.includes('\r\n') ? '\r\n' : '\n';
    ledger.settle(carried, emitted.uploads ?? []);
    const preamble = emitted.replayed ? ledger.shipFor(p.objects).map((l) => `${l}${sep}`).join('') : '';
    out += preamble + block;
    blocks.push({ start: base, end: out.length });
    for (const s of emitted.spans) {
      // The ^JM edits are in the bytes the ^DF edits left, so they apply second.
      const moved = shiftSpan(shiftSpan(s, stored.edits), applied.edits);
      spans.push({
        pageIndex,
        objectId: s.objectId,
        start: base + preamble.length + moved.start,
        end: base + preamble.length + moved.end,
      });
    }
  });
  return { text: out, spans, blocks };
}


/** One page's emitted bytes plus the format head they carry (`undefined` when unknown). */
interface PageBlock {
  block: string;
  head: FormatHead | undefined;
  spans: ObjectSpan[];
  replayed?: true;
  /** Keys of the graphic uploads the block's bytes ship, replayed or emitted. */
  uploads?: readonly string[];
}

/** How a replayed block treats its upload segments: `omit` names keys the wire already holds. */
interface UploadPolicy {
  omit: ReadonlySet<string>;
  keep: (seg: UploadSegment) => boolean;
}

/** Tracks, block by block, which upload keys the wire holds and which a block carried but dropped. */
function uploadLedger(pages: readonly Page[]) {
  const edited = pages.some(pageEdited);
  const state = edited ? classifyUploads(pages) : undefined;
  const held = new Set<string>();
  const lost = new Set<string>();
  const hold = (keys: readonly string[]) => {
    for (const key of keys) if (!state?.divergent.has(key)) held.add(key);
  };
  return {
    /** A block never omits its own keys, since it may drop its upload bytes and then has to ship them. */
    policyFor(carried: ReadonlySet<string>): UploadPolicy {
      const omit = new Set([...held].filter((key) => !carried.has(key)));
      return {
        omit,
        keep: (seg) => !omit.has(seg.key) && !seg.short && (!state || state.replayable.has(seg.key)),
      };
    },
    /** Records what a block shipped. Keys it carried but dropped fall due for a later recall. */
    settle(carried: ReadonlySet<string>, shipped: readonly string[]): void {
      hold(shipped);
      for (const key of carried) if (!held.has(key)) lost.add(key);
    },
    /** ~DY lines a replayed block owes the wire. Untouched, only what a regenerated block lost. */
    shipFor(objects: LabelObject[]): string[] {
      const shipped = graphicUploadLines(objects, (key) => !held.has(key) && (edited || lost.has(key)));
      hold(shipped.keys);
      return shipped.lines;
    },
  };
}

/** Block-relative [start, end) of one leaf's emitted bytes. */
interface ObjectSpan {
  objectId: string;
  start: number;
  end: number;
}

/** Density the head declares: the last VALID `^JM` wins, mirroring the parser
 *  (which ignores an invalid one rather than letting it clear the density).
 *  Undefined when nothing readable is declared. */
function declaredJm(block: string, head: FormatHead): JmDensity | undefined {
  for (let i = head.jmSpans.length - 1; i >= 0; i--) {
    const span = head.jmSpans[i];
    if (!span) continue;
    const v = jmDensityOf(block.slice(span.start + MIN_JM_SPAN, span.end), span.delim);
    if (v) return v;
  }
  return undefined;
}

/** True while the head's offsets still land, in bounds and in order, on the
 *  commands they were recorded for; a shifted or malformed head fails so the
 *  caller regenerates instead of splicing bytes it never owned. */
function headMatches(block: string, head: FormatHead): boolean {
  const nameAt = (at: number): string => block.slice(at + 1, at + 3).toUpperCase();
  if (head.at > block.length) return false;
  if (head.at > 0 && (block[head.at - 3] !== head.caret || nameAt(head.at - 3) !== 'XA')) {
    return false;
  }
  let cursor = 0;
  for (const s of head.jmSpans) {
    if (s.start < cursor || s.end < s.start + MIN_JM_SPAN || s.end > block.length) return false;
    if (block[s.start] !== (s.caret) || nameAt(s.start) !== 'JM') return false;
    cursor = s.end;
  }
  cursor = 0;
  for (const s of head.dfSpans ?? []) {
    if (s.start < cursor || s.end < s.start + MIN_DF_SPAN || s.end > block.length) return false;
    if (block[s.start] !== s.caret || nameAt(s.start) !== 'DF') return false;
    // The payload is re-read too: a span stretched past its line would cut the bytes behind it.
    const payload = block.slice(s.start + MIN_DF_SPAN, s.end);
    if (payload.includes(s.caret) || /[\r\n]/.test(payload)) return false;
    cursor = s.end;
  }
  return true;
}

/** A span after `edits` (all in the span's own offsets): an edit before it moves it, one inside it grows it. */
function shiftSpan<S extends { start: number; end: number }>(span: S, edits: readonly HeadEdit[]): S {
  let start = span.start;
  let end = span.end;
  for (const e of edits) {
    if (e.at <= span.start) {
      start += e.delta;
      end += e.delta;
    } else if (e.at < span.end) {
      end += e.delta;
    }
  }
  return { ...span, start, end };
}

/** The head after `edits`; `at` sits just past the ^XA, which no edit touches. */
function shiftHead(head: FormatHead, edits: readonly HeadEdit[], dfSpans: readonly DfSpan[] | undefined): FormatHead {
  return {
    ...head,
    jmSpans: head.jmSpans.map((s) => shiftSpan(s, edits)),
    dfSpans,
  };
}

/** Rewrites, cuts or inserts the block's ^DF so it names `path`. Untouched bytes replay as they are;
 *  once the model differs it owns the head, and a second declaration is cut with the first rewritten. */
function applyStoredFormat(
  emitted: PageBlock,
  path: string | undefined,
): { block: string; head: FormatHead | undefined; edits: HeadEdit[] } {
  const { block, head } = emitted;
  if (!head) return { block, head, edits: [] };
  const spans = head.dfSpans ?? [];
  const first = spans[0];
  if (!first) {
    if (path === undefined) return { block, head, edits: [] };
    // Right after the ^XA (p.174); a ^JM inserted later lands behind it.
    const injected = `${head.caret}DF${path}`;
    const edits = [{ at: head.at, delta: injected.length }];
    return {
      block: `${block.slice(0, head.at)}${injected}${block.slice(head.at)}`,
      head: shiftHead(head, edits, [{ start: head.at, end: head.at + injected.length, caret: head.caret, path }]),
      edits,
    };
  }
  const named = storedFormatSpanOf(spans);
  if (path !== undefined && named?.path === path) return { block, head, edits: [] };
  // Spans the model never took (unusable paths) are not the user clearing the field.
  if (path === undefined && !named) return { block, head, edits: [] };
  let out = block;
  const edits: HeadEdit[] = [];
  // Back to front, so the earlier offsets stay valid; a cut takes the line break with it.
  for (const [i, s] of [...spans.entries()].reverse()) {
    const keep = i === 0 && path !== undefined;
    const lineBreak = block.startsWith('\r\n', s.end) ? 2 : block.startsWith('\n', s.end) ? 1 : 0;
    const cutEnd = keep ? s.end : s.end + lineBreak;
    const replacement = keep ? `${s.caret}DF${path}` : '';
    out = `${out.slice(0, s.start)}${replacement}${out.slice(cutEnd)}`;
    edits.unshift({ at: s.start, delta: replacement.length - (cutEnd - s.start) });
  }
  const next = path === undefined ? undefined : [{ start: first.start, end: first.start + MIN_DF_SPAN + path.length, caret: first.caret, path }];
  return { block: out, head: shiftHead(head, edits, next), edits };
}

interface HeadEdit {
  at: number;
  delta: number;
}

/** Rewrites a block's head to the target density; the model wins over any
 *  existing declaration. `target` folds in the running wire state (undefined = nothing to add). */
function applyJmDensity(
  emitted: PageBlock,
  pageJm: JmDensity | undefined,
  target: JmDensity | undefined,
): { block: string; wireJm: JmDensity | undefined; edits: HeadEdit[] } {
  const { block, head } = emitted;
  if (!head) return { block, wireJm: undefined, edits: [] };
  const declared = declaredJm(block, head);
  if (declared !== undefined) {
    const want = pageJm ?? 'A';
    if (declared === want) return { block, wireJm: want, edits: [] };
    // Every declaration in the head is rewritten, not just the last: leaving a
    // stale one behind would make the density depend on emit order. Back to
    // front so the earlier spans keep their offsets.
    let rewritten = block;
    const edits: HeadEdit[] = [];
    for (const s of [...head.jmSpans].reverse()) {
      const params = block.slice(s.start + MIN_JM_SPAN, s.end);
      // ^JM takes one parameter; anything past the delimiter is unmodelled, so
      // carry it rather than dropping bytes the source had. Per-span delimiter so
      // a ^CD retarget mid-head splits at the right byte.
      const tailAt = params.indexOf(s.delim);
      const tail = tailAt < 0 ? '' : params.slice(tailAt);
      const replacement = `${s.caret}JM${want}${tail}`;
      edits.push({ at: s.start, delta: replacement.length - (s.end - s.start) });
      rewritten = `${rewritten.slice(0, s.start)}${replacement}${rewritten.slice(s.end)}`;
    }
    return { block: rewritten, wireJm: want, edits };
  }
  if (!target) return { block, wireJm: undefined, edits: [] };
  // Behind the head's last ^JM or ^DF, whichever comes later, since an unreadable ^JM must not
  // outrank a fresh one and a density ahead of the ^DF would sit outside the stored format.
  // With no spans, the ^XA caret is the injection point.
  const lastDf = head.dfSpans?.[head.dfSpans.length - 1];
  const tail = [head.jmSpans[head.jmSpans.length - 1], lastDf].filter((s) => s !== undefined).sort((a, b) => a.end - b.end).pop();
  const at = tail?.end ?? head.at;
  const caret = tail?.caret ?? head.caret;
  const injected = `${caret}JM${target}`;
  return {
    block: `${block.slice(0, at)}${injected}${block.slice(at)}`,
    wireJm: target,
    edits: [{ at, delta: injected.length }],
  };
}

/** `replayable`: keys still recalled by unchanged exported objects that agree on the raster, so their imported
 *  upload bytes may replay. `divergent`: keys whose shipping objects disagree, so every recall page ships its own. */
function classifyUploads(pages: readonly Page[]): { replayable: ReadonlySet<string>; divergent: ReadonlySet<string> } {
  const recalled = new Set<string>();
  const bytesByKey = new Map<string, string | undefined>();
  const changed = new Set<string>();
  const divergent = new Set<string>();
  for (const page of pages) {
    for (const obj of exportableLeaves(page.objects)) {
      if (obj.type !== 'image') continue;
      const p = obj.props as ImageProps;
      const key = uploadKey(p);
      if (!key) continue;
      recalled.add(key);
      if (obj.dirty) changed.add(key);
      if (!storedGraphicShips(p)) continue;
      if (bytesByKey.has(key) && bytesByKey.get(key) !== p._gfaCache) divergent.add(key);
      bytesByKey.set(key, p._gfaCache);
    }
  }
  return { replayable: new Set([...recalled].filter((key) => !changed.has(key) && !divergent.has(key))), divergent };
}

/** ~DY lines for the exported stored graphics, one per file; `wanted` narrows them to keys the wire lacks. */
function graphicUploadLines(objects: LabelObject[], wanted?: (key: string) => boolean): { lines: string[]; keys: string[] } {
  const lines: string[] = [];
  const keys: string[] = [];
  for (const obj of exportableLeaves(objects)) {
    if (obj.type !== 'image') continue;
    const p = obj.props as ImageProps;
    const key = uploadKey(p);
    if (!key || keys.includes(key) || (wanted && !wanted(key))) continue;
    const dy = graphicUploadLine(p);
    if (!dy) continue;
    // Claimed only once the ~DY exists, else objects sharing the key recall a file nobody sent.
    keys.push(key);
    lines.push(dy);
  }
  return { lines, keys };
}

/** Whether any exported object of the page was changed, added, removed, hidden or reordered since
 *  import; a page without an overlay is regenerated, so it counts as changed. */
function pageEdited(page: Page): boolean {
  const overlay = page.overlay;
  if (!overlay) return true;
  const segmentObjectOrder = overlay.segments.flatMap((s) => (s.kind === 'object' ? [s.objectId] : []));
  const linked = new Set(segmentObjectOrder);
  const exportable = exportableLeaves(page.objects);
  const live = exportable.filter((l) => linked.has(l.id)).length;
  return (
    exportable.some((l) => l.dirty || !linked.has(l.id)) ||
    live < linked.size ||
    linkedOrderChanged(segmentObjectOrder, exportable)
  );
}

function linkedOrderChanged(segmentObjectOrder: readonly string[], exportable: readonly LabelObject[]): boolean {
  const exportableIds = new Set(exportable.map((l) => l.id));
  const segmentIds = new Set(segmentObjectOrder);
  const liveLinkedOrder = exportable.filter((l) => segmentIds.has(l.id)).map((l) => l.id);
  const segmentLiveOrder = segmentObjectOrder.filter((id) => exportableIds.has(id));
  return liveLinkedOrder.some((id, i) => id !== segmentLiveOrder[i]);
}

/** Overlay replay plus the head those bytes carry, so the ^JM pass patches a
 *  parser-recorded position, not an inferred one. Label is pre-resolved (^JM override folded in). */
function emitPageBlock(
  label: PageLabel,
  page: Page,
  variables: readonly Variable[] = [],
  /** Absent for a lone block, which then replays every upload it holds. */
  policy?: UploadPolicy,
  shippedFonts?: Set<string>,
): PageBlock {
  const regen = () => generateZplBlock(label, page.objects, variables, undefined, policy?.omit, shippedFonts);
  const overlay = page.overlay;
  if (!overlay || !isOverlayConsistent(overlay)) return regen();

  const exportable = exportableLeaves(page.objects);
  const exportableById = new Map(exportable.map((l) => [l.id, l]));
  const segmentObjectOrder = overlay.segments.flatMap((s) =>
    s.kind === 'object' ? [s.objectId] : [],
  );
  const segmentIds = new Set(segmentObjectOrder);

  // Order guard: segments are pinned to source order, so a reorder/reparent
  // (z-order, group, ungroup) that changes the relative order of segment-linked
  // objects can't be expressed by per-segment patching; regenerate in model order.
  if (linkedOrderChanged(segmentObjectOrder, exportable)) return regen();
  const segmentLiveOrder = segmentObjectOrder.filter((id) => exportableById.has(id));
  // New objects are appended after all segments, so they must sit at the model
  // tail. If a segment-linked object follows a new one in model order, appending
  // would reorder it; fall back to full regeneration (model order).
  let sawNew = false;
  for (const l of exportable) {
    if (!segmentIds.has(l.id)) sawNew = true;
    else if (sawNew) return regen();
  }

  // Unsafe counted spans: linked segments re-emit from their wrapped model
  // bytes, unlinked ones (e.g. a ~DY no ^XG consumes) rewrite in place.
  // Detection runs on the joined block so earlier-segment remaps thread.
  const unsafeSpans = unsafeRawFieldSpans(overlay.segments.map((seg) => seg.text).join(''));
  const binarySegIds = new Set<string>();
  const rewrittenSegs = new Map<number, string>();
  let fullRegen = false;
  let segOffset = 0;
  overlay.segments.forEach((seg, i) => {
    const from = segOffset;
    const to = (segOffset += seg.text.length);
    const inSeg = unsafeSpans.filter((sp) => sp.start < to && sp.end > from);
    if (inSeg.some((sp) => sp.start < from || sp.end > to)) {
      fullRegen = true;
      return;
    }
    if (seg.kind === 'object') {
      if (inSeg.length > 0 || CONTROL_BYTES_RE.test(seg.text)) binarySegIds.add(seg.objectId);
      return;
    }
    if (inSeg.length === 0 && !CONTROL_BYTES_RE.test(seg.text)) return;
    const rewritten = rewriteRawFieldSpans(
      seg.text,
      inSeg.map((sp) => ({
        ...sp,
        start: sp.start - from,
        dataStart: sp.dataStart - from,
        formatStart: sp.formatStart - from,
        formatEnd: sp.formatEnd - from,
        end: sp.end - from,
      })),
    );
    // Residual control junk outside counted fields has no safe form.
    if (CONTROL_BYTES_RE.test(rewritten)) {
      fullRegen = true;
      return;
    }
    rewrittenSegs.set(i, rewritten);
  });
  if (fullRegen) return regen();

  const dirtyLeaves = exportable.filter(
    (l) => segmentIds.has(l.id) && (l.dirty || binarySegIds.has(l.id)),
  );
  const newLeaves = exportable.filter((l) => !segmentIds.has(l.id));

  // A verbatim replay of text-safe segments is byte-safe; a regeneration in a
  // non-regenSafe block is not, so fall back wholesale the moment an edit
  // (dirty or new) exists there.
  if ((dirtyLeaves.length > 0 || newLeaves.length > 0) && !overlay.regenSafe) {
    return regen();
  }
  // A delete or hide is neither dirty nor new, so the gate above misses it.
  // It is still an edit of a non-regenSafe block, and it can expose a dropped field's raw bytes.
  const removedFromExport = segmentLiveOrder.length < segmentObjectOrder.length;
  if (removedFromExport && (overlay.droppedField || !overlay.regenSafe)) {
    return regen();
  }

  // One shared emit context so a picked ^FE/^FC covers dirty and new fields alike.
  const dirtyShifted = shiftIntoFrame(dirtyLeaves, overlay.frame, label);
  const newShifted = shiftIntoFrame(newLeaves, overlay.frame, label);
  const { headerLines, emitCtx } = planTemplateHeader(
    [...dirtyShifted, ...newShifted],
    label,
    variables,
    overlay.frame,
  );

  // No ^A@->^A{alias} rewrite on the regen path: a regenerated direct-path ^A@
  // is valid and order-independent, whereas aliasing would break when the
  // block's ^CW sits after the field. Aliasing is a whole-document
  // normalization that only the model generator needs.
  const dirtyShiftedById = new Map(dirtyShifted.map((o) => [o.id, o]));

  const out: string[] = [];
  let spans: ObjectSpan[] = [];
  let offset = 0;
  const push = (text: string): void => {
    out.push(text);
    offset += text.length;
  };
  // The block's own separator for every injected line, or a CRLF page exports mixed;
  // re-joining generated bodies is safe since fields encode line breaks as \&.
  const sep = overlay.segments.some((s) => s.text.includes('\r\n')) ? '\r\n' : '\n';
  let headerEmitted = false;
  const emitHeaderOnce = () => {
    if (headerEmitted) return;
    headerEmitted = true;
    if (headerLines.length > 0) push(`${headerLines.join(sep)}${sep}`);
  };

  const replayedUploads: string[] = [];
  for (const [i, seg] of overlay.segments.entries()) {
    if (seg.kind !== 'object') {
      if (seg.kind === 'upload') {
        if (policy && !policy.keep(seg)) continue;
        replayedUploads.push(seg.key);
      }
      push(rewrittenSegs.get(i) ?? seg.text);
      continue;
    }
    // object segment
    const live = exportableById.get(seg.objectId);
    if (!live) continue; // deleted or hidden
    if (!live.dirty && !binarySegIds.has(seg.objectId)) {
      const start = offset;
      push(seg.text);
      spans.push({ objectId: seg.objectId, start, end: offset });
      continue;
    }
    emitHeaderOnce(); // template/clock header precedes the first regenerated field
    const shifted = dirtyShiftedById.get(seg.objectId);
    if (shifted && !isGroup(shifted)) {
      const start = offset;
      push(emitFieldBody(shifted, emitCtx).replaceAll('\n', sep));
      spans.push({ objectId: seg.objectId, start, end: offset });
    }
  }

  let result = out.join('');

  if (newShifted.length > 0) {
    const entries: { objectId?: string; text: string }[] = [];
    if (!headerEmitted && headerLines.length > 0) {
      entries.push(...headerLines.map((text) => ({ text })));
    }
    for (const o of newShifted) {
      if (!isGroup(o)) {
        entries.push({ objectId: o.id, text: emitFieldBody(o, emitCtx).replaceAll('\n', sep) });
      }
    }
    const block = entries.map((e) => e.text).join(sep);
    // New fields go inside the block, just before ^XZ. ZPL command letters are
    // case-insensitive; check the common uppercase form first, then a regex on
    // the original for a rare lowercase terminator (matching the original keeps
    // slice indices accurate, unlike toUpperCase which can grow e.g. ß into SS).
    let idx = result.lastIndexOf('^XZ');
    if (idx < 0) idx = [...result.matchAll(/\^[xX][zZ]/g)].pop()?.index ?? -1;
    const at = idx >= 0 ? idx : result.length + sep.length;
    // Appending straight behind a field ^XZ closed would make the printer drop it.
    // A regenerated or deleted tail already ends in ^FS, so the bytes decide, not the flag.
    const lead = overlay.openTail && !/\^FS\s*$/i.test(result.slice(0, at)) ? `^FS${sep}` : '';
    const grown = lead.length + block.length + sep.length;
    spans = spans.flatMap((s) =>
      s.start >= at
        ? [{ ...s, start: s.start + grown, end: s.end + grown }]
        : // A degenerate stream can carry its last ^XZ inside an object's bytes, so
          // the splice tears it apart and no contiguous span describes it anymore.
          s.end > at
          ? []
          : [s],
    );
    let insOff = at + lead.length;
    for (const e of entries) {
      if (e.objectId !== undefined) {
        spans.push({ objectId: e.objectId, start: insOff, end: insOff + e.text.length });
      }
      insOff += e.text.length + sep.length;
    }
    result =
      idx >= 0 ? `${result.slice(0, idx)}${lead}${block}${sep}${result.slice(idx)}` : `${result}${sep}${lead}${block}`;
  }

  const head = overlay.head;
  // Appended spans are pushed last but can precede shifted ones; contract is ascending.
  spans.sort((a, b) => a.start - b.start);
  return { block: result, head: head && headMatches(result, head) ? head : undefined, spans, replayed: true, uploads: replayedUploads };
}

/** Where a batch stores its template when the design names none ^XF could recall: R: is volatile RAM, matching a single run. */
const BATCH_TEMPLATE_PATH = 'R:LBL.ZPL';

/** Store template via ^DF then emit one ^XA^XF...^XZ recall block per
 *  CSV row. Unmapped variables fall back to the template's ^FD default. */
export function generateBatchZpl(
  // Page-resolved: batch recalls one page's objects, so the caller must hand
  // in the label that page prints at.
  label: PageLabel,
  objects: LabelObject[],
  variables: readonly Variable[],
  dataset: {
    headers: readonly string[];
    rows: readonly (readonly string[])[];
  },
  columnMapping: { bindings: Record<string, string> },
): string {
  const identity = (s: string) => s;
  // Only leaves that emit an ^FN in the stored template may donate their
  // transform: an excluded or home-dropped leaf or a rotated QR shipped as
  // ^GFA would stamp a foreign encoding onto the surviving co-consumer.
  const shifted = shiftObjectsByHome(
    objects, label.labelHomeX ?? 0, label.labelHomeY ?? 0, label.labelTop ?? 0, label,
  );
  const leaves = exportableLeaves(shifted).filter(
    (o) => !(qrPrintsAsGraphic(o) && resolveContentPreview(getObjectStringContent(o) ?? '', variables)),
  );
  // Same shifted tree the template's own header pass classifies; the donor
  // filter above is the narrower "emits an ^FN" question.
  const batchBuckets = fnConsumerBuckets(shifted, variables);
  const modeDFns = batchBuckets.modeDExclusive;
  const plain128Fns = batchBuckets.plainExclusive;
  const plainSharedFns = batchBuckets.plainShared;
  const overrides: { fn: number; colIdx: number; transform: (s: string) => string }[] = [];
  for (const v of variables) {
    const colIdx = boundColumnIndex(v, dataset, columnMapping);
    if (colIdx === -1) continue;
    // Apply the bound field's ^FD transform (QR prefix, UPC-E compaction, GS1
    // escaping) to each row value, matching the single-format export so the
    // recall doesn't overwrite ^FN with an untransformed payload. The bound
    // field is the one whose content is exactly this variable's marker.
    const bound = leaves.find((o) => {
      const c = getObjectStringContent(o);
      if (c === undefined) return false;
      const cls = classifyField(c, variables);
      return cls.kind === "single" && cls.variable.id === v.id;
    });
    // A template-embedded mode-D or plain-^BC slot has no bound transform but
    // still needs its escape. A shared plain slot bound to the code128 emits
    // raw instead: the escape would corrupt the co-consumers.
    const boundEntry = bound && !isGroup(bound) ? getEntry(bound.type) : undefined;
    const boundPlainShared =
      bound && !isGroup(bound)
      && usesPlainCode128Escape(boundEntry, bound.props)
      && plainSharedFns.has(v.fnNumber);
    const transform = boundPlainShared
      ? (s: string) => planCode128Fd(s, 'sharedRaw').fd
      : (bound && !isGroup(bound) ? boundEntry?.fdTransform?.(bound) : undefined) ??
        (modeDFns.has(v.fnNumber)
          ? escapeGs1FdValue
          : plain128Fns.has(v.fnNumber)
            ? (s: string) => planCode128Fd(s, 'templateValue').fd
            : identity);
    overrides.push({ fn: v.fnNumber, colIdx, transform });
  }

  // Mapped slots stay bare in the stored format; the recall supplies them.
  const mappedFns = new Set(overrides.map((o) => o.fn));
  const templatePath = label.storedFormatPath && isRecallableFormatPath(label.storedFormatPath) ? label.storedFormatPath : BATCH_TEMPLATE_PATH;
  const templateStored = generateZplBlock({ ...label, storedFormatPath: templatePath }, objects, variables, mappedFns).block;
  // A recall for a slot the stored format never declares prints as a stray field (ZD230).
  const storedFnSlots = new Set([...templateStored.matchAll(/\^FN(\d+)/g)].map((m) => Number(m[1])));
  const recalls = overrides.filter((o) => storedFnSlots.has(o.fn));

  const recallBlocks = dataset.rows.map((row) => {
    const lines: string[] = ['^XA', `^XF${templatePath}`];
    for (const { fn, colIdx, transform } of recalls) {
      const value = row[colIdx] ?? '';
      // fdField applies ^FH hex-escape for ^/~ so fields don't terminate early.
      lines.push(`^FN${fn}${fdField(transform(value))}`);
    }
    lines.push('^XZ');
    return lines.join('\n');
  });

  return [templateStored, ...recallBlocks].join('\n');
}

// ^FT graphics anchor at a bottom corner (spec p.205), so the drop test uses
// that anchor for GRAPHIC_ANCHOR_TYPES. Barcodes emit ^FT at the model coord
// (the plain check holds); rotated text ^FT uses a baseline anchor, where the
// top-left check is only approximate (a pre-existing edge, untouched here).

/** Home-relative to a parsed ^LH/^LT frame, not the label's own home/top (see OverlayFrame). */
export function shiftIntoFrame(objects: LabelObject[], frame: OverlayFrame | undefined, label: PageLabel): LabelObject[] {
  return frame ? shiftObjectsByHome(objects, frame.homeX, frame.homeY, frame.top, label) : objects;
}

/** Subtract label home/top from each object so emit matches the editor, the
 *  inverse of the parser folding ^LH/^LT into absolute coords. Leaves whose
 *  emitted origin goes negative are dropped (Zebra rejects negative ^FO/^FT and
 *  clamping would relocate them silently). Identity when no shift applies. */
function shiftObjectsByHome(
  objects: LabelObject[],
  homeX: number,
  homeY: number,
  top: number,
  label: PageLabel,
): LabelObject[] {
  if (homeX === 0 && homeY === 0 && top === 0) return objects;
  const ctx: ObjectBoundsCtx = { label };
  const shiftOrDrop = (obj: LabelObject): LabelObject[] => {
    if (isGroup(obj)) {
      return [{ ...obj, children: obj.children.flatMap(shiftOrDrop) }];
    }
    const x = obj.x - homeX;
    const y = obj.y - homeY - top;
    // ^FT graphics anchor at a bottom corner, so test the emitted anchor
    // (footprint bottom, right edge when justify R) rather than the top-left.
    if (obj.positionType === 'FT' && GRAPHIC_ANCHOR_TYPES.has(obj.type)) {
      const b = objectBoundsDots(obj, ctx);
      let w = b.width;
      let h = b.height;
      // Image emit dims differ from the footprint (byte-padded width, aspect
      // height, R/B axis swap), so key the drop check off imageEmitDims like
      // toZPL. Other graphics emit their footprint verbatim.
      if (obj.type === 'image') {
        const d = imageEmitDims(obj.props);
        w = d.width;
        h = d.height;
      }
      const anchorX = (obj.fieldJustify === 'R' ? b.x + w : b.x) - homeX;
      const anchorY = b.y + h - homeY - top;
      return anchorX < 0 || anchorY < 0 ? [] : [{ ...obj, x, y }];
    }
    // Gated 1D-R emits its right anchor (x+w); drop-test that, like graphics.
    if (BARCODE_1D_TYPES.has(obj.type)) {
      const ax = printerAnchoredX(obj, label);
      if (ax !== null) return ax - homeX < 0 || y < 0 ? [] : [{ ...obj, x, y }];
    }
    return x < 0 || y < 0 ? [] : [{ ...obj, x, y }];
  };
  return objects.flatMap(shiftOrDrop);
}

/** Template header lines plus the per-object field bodies, shared by the full
 *  generator and selection copy so the two never drift. Applies the label
 *  home/top shift (dropping negative origins) and the template/clock emit
 *  context, but emits no ^XA / label config / ^XZ. */
export function planFieldEmission(
  label: PageLabel,
  objects: LabelObject[],
  variables: readonly Variable[] = [],
  bareFnSlots?: ReadonlySet<number>,
): { headerLines: string[]; bodies: EmittedBody[] } {
  const homeX = label.labelHomeX ?? 0;
  const homeY = label.labelHomeY ?? 0;
  const top = label.labelTop ?? 0;
  const shifted = shiftObjectsByHome(objects, homeX, homeY, top, label);

  const { headerLines, emitCtx } = planTemplateHeader(shifted, label, variables, { homeX, homeY, top }, bareFnSlots);

  return {
    headerLines,
    bodies: exportableLeaves(shifted).map((o) => ({ objectId: o.id, text: emitFieldBody(o, emitCtx) })),
  };
}

/** One leaf's emitted field bytes, id-attributed for the span map. */
export interface EmittedBody {
  objectId: string;
  text: string;
}

/** Positional-command slots with trailing empties dropped, so unset
 *  params fall back to the printer's own defaults on the wire. */
export function trimTrailingEmptySlots(slots: readonly string[]): string[] {
  const trimmed = [...slots];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
  return trimmed;
}

export function generateZPL(
  label: LabelConfig,
  objects: LabelObject[],
  variables: readonly Variable[] = [],
): string {
  // Public single-block entry: callers own the page scope (generateMultiPageZPL
  // folds ^JM itself, the app passes currentPageLabel), so the brand starts here.
  return generateZplBlock(designAsPageLabel(label), objects, variables).block;
}

/** Model emit plus the format head it wrote. The head is exact by construction
 *  rather than searched for; the ^A@ aliasing at the end only rewrites body
 *  bytes, so the offsets survive it. */
function generateZplBlock(
  label: PageLabel,
  objects: LabelObject[],
  variables: readonly Variable[] = [],
  bareFnSlots?: ReadonlySet<number>,
  omitUploads?: ReadonlySet<string>,
  /** Shared across a document's blocks so a font ships once. A replayed block's own ~DY stays invisible to it, which costs size only. */
  shippedFonts = new Set<string>(),
): PageBlock {
  // ^PW/^LL are consumed in physical head dots (ZD230-verified), even under
  // ^JMB: the body's object dots emit in the effective (halved) scale, but the
  // print width/length stay physical.
  const widthDots = mmToDots(label.widthMm, label.dpmm);
  const heightDots = mmToDots(label.heightMm, label.dpmm);

  const lines: string[] = [];

  // ~DY ships font bytes before ^XA so ^CW/^A resolve against them.
  for (const m of label.customFonts ?? []) {
    if (!m.path || !m.embedInZpl || shippedFonts.has(storageKey(m.path))) continue;
    const line = formatDownloadObject(m);
    if (!line) continue;
    lines.push(line);
    shippedFonts.add(storageKey(m.path));
  }

  const uploads = graphicUploadLines(objects, omitUploads && ((key) => !omitUploads.has(key)));
  lines.push(...uploads.lines);

  // ~SD is immediate (not EEPROM), emit before ^XA so it applies to this label.
  if (label.instantDarkness !== undefined) {
    const v = String(label.instantDarkness).padStart(2, '0');
    lines.push(`~SD${v}`);
  }

  // ~JS is immediate/transient like ~SD; emit before ^XA.
  if (label.backfeedSequence) lines.push(`~JS${label.backfeedSequence}`);

  lines.push('^XA');
  const lineStart = () => lines.reduce((n, l) => n + l.length + 1, 0);
  // Offset just past the ^XA: every preceding line plus its newline.
  const headAt = lineStart() - 1;
  // ^DF stores everything after it, so it comes first (p.174), and without ^FS
  // (p.269: a terminator ahead of ^JM disables the density).
  let dfSpans: DfSpan[] | undefined;
  if (label.storedFormatPath) {
    const df = `^DF${label.storedFormatPath}`;
    dfSpans = [{ start: lineStart(), end: lineStart() + df.length, caret: '^', path: label.storedFormatPath }];
    lines.push(df);
  }
  // ^JM must precede the first ^FS (p269), and the sidecar comment below
  // already closes with one; emit it first.
  const jmSpans: JmSpan[] = [];
  if (label.jmDensity) {
    const jm = `^JM${label.jmDensity}`;
    jmSpans.push({ start: lineStart(), end: lineStart() + jm.length, delim: ',', caret: '^' });
    lines.push(jm);
  }
  // Leading geometry sidecar: recovers exact width/height/dpmm on re-import,
  // which plain ^PW/^LL (dots, no dpmm) can't. A comment, so print is unaffected.
  lines.push(formatLabelMetaComment(labelMetaOf(label)));
  // a=D since model is dots-canonical.
  if (label.muResampling) {
    lines.push(`^MUD,${label.muResampling.formatDpi},${label.muResampling.outputDpi}`);
  }
  lines.push(
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    '^CI28',
  );

  if (label.mediaMode) lines.push(`^MM${label.mediaMode}`);
  if (label.mediaType) lines.push(`^MT${label.mediaType}`);
  if (label.mediaTracking) lines.push(`^MN${label.mediaTracking}`);

  const rsSlots = trimTrailingEmptySlots([
    label.rfidTagType?.toString() ?? '',
    label.rfidPosition ?? '',
    label.rfidVoidLength?.toString() ?? '',
    label.rfidRetries?.toString() ?? '',
    label.rfidErrorHandling ?? '',
    '',
    '',
    label.rfidVoidSpeed?.toString() ?? '',
  ]);
  if (rsSlots.length > 0) lines.push(`^RS${rsSlots.join(',')}`);
  if (label.rfidEpcBits !== undefined) {
    const parts = label.rfidEpcPartitions ? `,${label.rfidEpcPartitions.join(',')}` : '';
    lines.push(`^RB${label.rfidEpcBits}${parts}`);
  }
  if (label.rfidReadPower !== undefined || label.rfidWritePower !== undefined) {
    const slots = trimTrailingEmptySlots([
      label.rfidReadPower?.toString() ?? '',
      label.rfidWritePower?.toString() ?? '',
    ]);
    lines.push(`^RW${slots.join(',')}`);
  }
  if (label.maxLabelLength !== undefined) lines.push(`^ML${label.maxLabelLength}`);
  // Positional pair; default the unset slot to "N" (no motion).
  if (label.mediaFeedPowerUp || label.mediaFeedHeadClose) {
    const p1 = label.mediaFeedPowerUp ?? 'N';
    const p2 = label.mediaFeedHeadClose ?? 'N';
    lines.push(`^MF${p1},${p2}`);
  }
  if (label.suppressBackfeed) lines.push('^XB');
  // ^PR positional; backfeed-only still has to repeat print in the slew slot.
  const fallback = label.printSpeed ?? label.slewSpeed ?? label.backfeedSpeed;
  if (fallback !== undefined) {
    const parts = [fallback];
    if (label.slewSpeed !== undefined || label.backfeedSpeed !== undefined) {
      parts.push(label.slewSpeed ?? fallback);
    }
    if (label.backfeedSpeed !== undefined) parts.push(label.backfeedSpeed);
    lines.push(`^PR${parts.join(',')}`);
  }
  // darkness=0 is valid (baseline); check undefined explicitly.
  if (label.darkness !== undefined) lines.push(`^MD${label.darkness}`);
  if (label.printOrientation) lines.push(`^PO${label.printOrientation}`);
  if (label.mirror) lines.push(`^PM${label.mirror}`);
  if (label.mapClear) lines.push(`^MC${label.mapClear}`);
  // slewDotRows=0 is a valid explicit "no slew"; check undefined.
  if (label.slewDotRows !== undefined) lines.push(`^PF${label.slewDotRows}`);
  if (label.slewToHome) lines.push('^PH');
  if (label.programmablePause) lines.push('^PP');
  // ^LH / ^LT subtract below from per-field absolute (x,y) so emit matches editor.
  const homeX = label.labelHomeX ?? 0;
  const homeY = label.labelHomeY ?? 0;
  const top = label.labelTop ?? 0;
  if (homeX !== 0 || homeY !== 0) lines.push(`^LH${homeX},${homeY}`);
  if (top !== 0) lines.push(`^LT${top}`);
  if (label.labelShift) lines.push(`^LS${label.labelShift}`);

  // ^CW alias->path; skip empty (in-progress UI rows would emit malformed lines).
  if (label.customFonts?.length) {
    for (const f of label.customFonts) {
      // Free-text settings reaching a parameter slot: without this an alias or
      // path carrying ^ ~ or , ends the line early and the rest executes.
      if (f.alias && f.path) {
        lines.push(`^CW${stripZplParamChars(f.alias)},${stripZplParamChars(f.path.trim())}`);
      }
    }
  }

  // ^CF f,h,w positional; trim trailing empty slots.
  if (
    label.defaultFontId ||
    label.defaultFontHeight !== undefined ||
    label.defaultFontWidth !== undefined
  ) {
    const slots = trimTrailingEmptySlots([
      stripZplParamChars(label.defaultFontId ?? ""),
      label.defaultFontHeight !== undefined ? String(label.defaultFontHeight) : "",
      label.defaultFontWidth !== undefined ? String(label.defaultFontWidth) : "",
    ]);
    lines.push(`^CF${slots.join(",")}`);
  }

  const { headerLines, bodies } = planFieldEmission(label, objects, variables, bareFnSlots);
  lines.push(...headerLines);
  const bodyIdByLine = new Map<number, string>();
  for (const b of bodies) {
    bodyIdByLine.set(lines.length, b.objectId);
    lines.push(b.text);
  }

  // ^PQ q,p,r,o (defaults q=1 p=0 r=0 o=N); emit if q>1 or any extended set.
  const pq = label.printQuantity ?? 1;
  const pause = label.pauseCount ?? 0;
  const reps = label.replicates ?? 0;
  const override = label.overridePauseCount ?? 'N';
  const pqExtended = pause !== 0 || reps !== 0 || override !== 'N';
  if (pqExtended) {
    lines.push(`^PQ${pq},${pause},${reps},${override}`);
  } else if (pq > 1) {
    lines.push(`^PQ${pq}`);
  }

  lines.push('^XZ');

  // Per-line aliasing so the span offsets stay true against the final bytes;
  // the ^A@ pattern never crosses a newline, so this matches a whole-text pass.
  const fonts = designFonts(label);
  const aliased =
    fonts.paths.length === 0 ? lines : lines.map((l) => aliasFontPathsLine(l, fonts));
  const spans: ObjectSpan[] = [];
  let off = 0;
  aliased.forEach((l, i) => {
    const objectId = bodyIdByLine.get(i);
    if (objectId !== undefined) spans.push({ objectId, start: off, end: off + l.length });
    off += l.length + 1;
  });

  return {
    block: aliased.join('\n'),
    head: { caret: '^', at: headAt, jmSpans, ...(dfSpans ? { dfSpans } : {}) },
    spans,
    uploads: uploads.keys,
  };
}

interface DesignFonts {
  aliasByPath: Map<string, string>;
  paths: string[];
}

function designFonts(label: LabelConfig): DesignFonts {
  const aliasByPath = new Map<string, string>();
  const paths: string[] = [];
  for (const m of label.customFonts ?? []) {
    if (!m.path) continue;
    paths.push(m.path);
    if (m.alias) aliasByPath.set(storageKey(m.path), m.alias);
  }
  return { aliasByPath, paths };
}

/** Model generator only: the overlay keeps direct paths, or a ^A would point at a ^CW not yet sent. */
function aliasFontPathsLine(line: string, fonts: DesignFonts): string {
  return line.replace(
    /\^A@([NIRB]),(\d+),(\d+),([^^\n]+?)(?=\^|\n|$)/g,
    (full, rot, h, w, ref) => {
      const path = fonts.paths.find((p) => storageRefMatchesPath(ref, p));
      const alias = path && fonts.aliasByPath.get(storageKey(path));
      return alias ? `^A${alias}${rot},${h},${w}` : full;
    },
  );
}
