import { mmToDots } from './coordinates';
import { getEntry, isGs1Active, BARCODE_1D_TYPES } from '../registry';
import { fdField, stripZplCommandChars, GRAPHIC_ANCHOR_TYPES, printerAnchoredX } from '../registry/zplHelpers';
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
import { formatLabelMetaComment } from './zplLabelMeta';
import { jmDensityOf } from '../types/LabelConfig';
import type { ClockOffset, CustomFontMapping, JmDensity, LabelConfig } from '../types/LabelConfig';
import type { ZplEmitContext } from '../types/ZplEmit';
import type { Variable } from '../types/Variable';
import { exportableLeaves, isGroup, pageLabelConfig, walkObjects, type LabelObject, type LeafObject, type Page } from '../types/Group';
import { isOverlayConsistent, MIN_JM_SPAN, type FormatHead, type JmSpan } from './zplOverlay/overlay';
import { reconstructBlockHead } from './zplHeadScan';
import { objectBoundsDots, type ObjectBoundsCtx } from './objectBounds';
import { formatFontDownloadFromPath } from './customFonts';
import { imageEmitDims, type ImageProps } from '../registry/image';
import { formatStoragePath } from './storagePath';

function formatDownloadObject(m: CustomFontMapping): string | undefined {
  if (!m.embedInZpl || !m.path || !m.previewFontName) return undefined;
  return formatFontDownloadFromPath(m.path, m.previewFontName);
}

/** Render a leaf to its field bytes, prefixed with its ^FX comment when set.
 *  Shared by the model generator and the overlay regeneration path so the two
 *  never drift on comment handling. */
function emitFieldBody(obj: LeafObject, emitCtx: ZplEmitContext): string {
  const zpl = getEntry(obj.type)?.toZPL(obj, emitCtx) ?? '';
  return obj.comment ? `^FX${stripZplCommandChars(obj.comment)}\n${zpl}` : zpl;
}

function flattenObjects(objects: LabelObject[]): LabelObject[] {
  const out: LabelObject[] = [];
  const walk = (list: LabelObject[]): void => {
    for (const o of list) {
      if (isGroup(o)) walk(o.children);
      else out.push(o);
    }
  };
  walk(objects);
  return out;
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
): { headerLines: string[]; emitCtx: ZplEmitContext } {
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
  for (const leaf of flattenObjects(shifted)) {
    if (leaf.includeInExport === false) continue;
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
      leafEntry?.ctrlNeedsOwnEscape
      && !isGs1Active(leafEntry, (leaf as { props?: object }).props)
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

  if (pickedEmbedChar !== null) {
    for (const [fn, v] of [...templateVarsByFn].sort(([a], [b]) => a - b)) {
      if (singleBindFns.has(fn)) continue;
      // Mode-D-exclusive slot: > needs its >0 invocation (parser reverses).
      // Plain-^BC-exclusive slot likewise: >/^/~ need their invocation
      // literals; the ^FH hex fdField would otherwise use is dropped from
      // the symbol.
      const def = modeDFns.has(fn)
        ? escapeGs1FdValue(v.defaultValue)
        : plain128Fns.has(fn)
          ? planCode128Fd(v.defaultValue, 'templateValue').fd
          : v.defaultValue;
      headerLines.push(`^FN${fn}${fdField(def)}`);
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

/** ~DY for a graphic upload. Format letter is preserved so :Z64: stays paired with C. */
function formatGraphicUpload(p: ImageProps): string | undefined {
  if (!p.storedAs || !p._gfaCache) return undefined;
  // Byte-count headers are optional in ^GF, hence \d* not \d+.
  const m = /^\^GF([ABC]),(\d*),(\d*),(\d+),([\s\S]*)$/.exec(p._gfaCache);
  if (!m) return undefined;
  const format = m[1];
  const total = m[2];
  const bpr = m[4];
  const data = m[5];
  return `~DY${formatStoragePath(p.storedAs, false)},${format},G,${total},${bpr},${data}`;
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
  let out = '';
  // ^JM persists on the wire, so a block only declares a density the preceding
  // blocks didn't set. `undefined` means nothing declared one yet, so a block
  // inheriting its ^JM from outside this export gets the declaration back.
  let wireJm: JmDensity | undefined;
  for (const p of pages) {
    const pageLabel = pageLabelConfig(label, p);
    let emitted: PageBlock;
    try {
      emitted = emitPageBlock(pageLabel, p, variables);
    } catch (err) {
      // A throw here is an unexpected bug, not an expected inconsistency (those
      // are handled internally); warn instead of failing silently, then regenerate.
      console.warn('emitPageBlock failed, regenerating page from model', err);
      emitted = generateZplBlock(pageLabel, p.objects, variables);
    }
    // Unset means full density, so a page after a ^JMB page resets the wire;
    // while nothing is declared yet there is nothing to reset.
    const target = pageLabel.jmDensity ?? (wireJm ? 'A' : undefined);
    // A replayed block whose head the parser never recorded (or whose bytes
    // moved) has no place to splice a declaration; a density-only scan of its
    // bytes (cold path) decides instead of always regenerating.
    if (!emitted.head && target !== undefined) {
      const action = headlessAction(reconstructBlockHead(emitted.block).density, target, wireJm);
      if (action === 'regenerate') {
        emitted = generateZplBlock(pageLabel, p.objects, variables);
      } else if (action === 'keep') {
        // applyJmDensity can't read a head-less block, so latch the wire here.
        wireJm = target;
      }
    }
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
    out += block;
  }
  return out;
}


/** One page's emitted bytes plus the format head they carry (`undefined` when unknown). */
interface PageBlock {
  block: string;
  head: FormatHead | undefined;
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
  return true;
}

/** Rewrites a block's head to the target density; the model wins over any
 *  existing declaration. `target` folds in the running wire state (undefined = nothing to add). */
function applyJmDensity(
  emitted: PageBlock,
  pageJm: JmDensity | undefined,
  target: JmDensity | undefined,
): { block: string; wireJm: JmDensity | undefined } {
  const { block, head } = emitted;
  if (!head) return { block, wireJm: undefined };
  const declared = declaredJm(block, head);
  if (declared !== undefined) {
    const want = pageJm ?? 'A';
    if (declared === want) return { block, wireJm: want };
    // Every declaration in the head is rewritten, not just the last: leaving a
    // stale one behind would make the density depend on emit order. Back to
    // front so the earlier spans keep their offsets.
    let rewritten = block;
    for (const s of [...head.jmSpans].reverse()) {
      const params = block.slice(s.start + MIN_JM_SPAN, s.end);
      // ^JM takes one parameter; anything past the delimiter is unmodelled, so
      // carry it rather than dropping bytes the source had. Per-span delimiter so
      // a ^CD retarget mid-head splits at the right byte.
      const tailAt = params.indexOf(s.delim);
      const tail = tailAt < 0 ? '' : params.slice(tailAt);
      rewritten = `${rewritten.slice(0, s.start)}${s.caret}JM${want}${tail}${rewritten.slice(s.end)}`;
    }
    return { block: rewritten, wireJm: want };
  }
  if (!target) return { block, wireJm: undefined };
  // Insert after the head's last ^JM, not before, since an unreadable one would
  // otherwise outrank a fresh declaration; with no spans, the ^XA caret is the
  // injection point.
  const last = head.jmSpans[head.jmSpans.length - 1];
  const at = last ? last.end : head.at;
  const caret = last ? last.caret : head.caret;
  return {
    block: `${block.slice(0, at)}${caret}JM${target}${block.slice(at)}`,
    wireJm: target,
  };
}

/** Emit one page from its overlay: verbatim segments for untouched objects,
 *  in-place regeneration for dirty ones, appended fields for new ones, raw
 *  segments (config/comments/unmodeled commands/whitespace) replayed as-is.
 *  Falls back to full regeneration when the overlay is missing/inconsistent,
 *  or when an edit exists in a block whose running state (^MU/prefix/^CI/^FE)
 *  would re-interpret a regenerated field.
 *  Single-block only: skips the wire-state ^JM pass, so it won't declare an
 *  inherited or head-less density; real exports use generateMultiPageZPL. */
export function emitOverlayPage(
  design: LabelConfig,
  page: Page,
  variables: readonly Variable[] = [],
): string {
  return emitPageBlock(pageLabelConfig(design, page), page, variables).block;
}

/** Overlay replay plus the head those bytes carry, so the ^JM pass patches a
 *  parser-recorded position, not an inferred one. Label is pre-resolved (^JM override folded in). */
function emitPageBlock(
  label: LabelConfig,
  page: Page,
  variables: readonly Variable[] = [],
): PageBlock {
  const overlay = page.overlay;
  if (!overlay || !isOverlayConsistent(overlay)) {
    return generateZplBlock(label, page.objects, variables);
  }

  const exportable = exportableLeaves(page.objects);
  const exportableById = new Map(exportable.map((l) => [l.id, l]));
  const segmentObjectOrder = overlay.segments.flatMap((s) =>
    s.kind === 'object' ? [s.objectId] : [],
  );
  const segmentIds = new Set(segmentObjectOrder);

  // Order guard: segments are pinned to source order, so a reorder/reparent
  // (z-order, group, ungroup) that changes the relative order of segment-linked
  // objects can't be expressed by per-segment patching. Detect it by comparing
  // the live order of still-present linked objects against their segment order,
  // and fall back to full regeneration (which emits in model order).
  const liveLinkedOrder = exportable.filter((l) => segmentIds.has(l.id)).map((l) => l.id);
  const segmentLiveOrder = segmentObjectOrder.filter((id) => exportableById.has(id));
  if (liveLinkedOrder.some((id, i) => id !== segmentLiveOrder[i])) {
    return generateZplBlock(label, page.objects, variables);
  }
  // New objects are appended after all segments, so they must sit at the model
  // tail. If a segment-linked object follows a new one in model order, appending
  // would reorder it; fall back to full regeneration (model order).
  let sawNew = false;
  for (const l of exportable) {
    if (!segmentIds.has(l.id)) sawNew = true;
    else if (sawNew) return generateZplBlock(label, page.objects, variables);
  }

  const dirtyLeaves = exportable.filter((l) => segmentIds.has(l.id) && l.dirty);
  const newLeaves = exportable.filter((l) => !segmentIds.has(l.id));

  // A verbatim 0-edit replay is always byte-safe; a regeneration in a
  // non-regenSafe block is not, so fall back wholesale the moment an edit
  // (dirty or new) exists there.
  if ((dirtyLeaves.length > 0 || newLeaves.length > 0) && !overlay.regenSafe) {
    return generateZplBlock(label, page.objects, variables);
  }

  const fx = overlay.frame?.homeX ?? 0;
  const fy = overlay.frame?.homeY ?? 0;
  const ft = overlay.frame?.top ?? 0;
  // Regenerated objects must be home-relative so they compose with the raw
  // ^LH/^LT that still execute on replay (no double-shift). One shared emit
  // context so a picked ^FE/^FC covers dirty and new fields alike.
  const dirtyShifted = shiftObjectsByHome(dirtyLeaves, fx, fy, ft, label);
  const newShifted = shiftObjectsByHome(newLeaves, fx, fy, ft, label);
  const { headerLines, emitCtx } = planTemplateHeader(
    [...dirtyShifted, ...newShifted],
    label,
    variables,
  );

  // No ^A@->^A{alias} rewrite on the regen path: a regenerated direct-path ^A@
  // is valid and order-independent, whereas aliasing would break when the
  // block's ^CW sits after the field. Aliasing is a whole-document
  // normalization that only the model generator needs.
  const dirtyShiftedById = new Map(dirtyShifted.map((o) => [o.id, o]));

  const out: string[] = [];
  let headerEmitted = false;
  const emitHeaderOnce = () => {
    if (headerEmitted) return;
    headerEmitted = true;
    if (headerLines.length > 0) out.push(`${headerLines.join('\n')}\n`);
  };

  for (const seg of overlay.segments) {
    if (seg.kind === 'raw' || seg.kind === 'config') {
      out.push(seg.text);
      continue;
    }
    // object segment
    const live = exportableById.get(seg.objectId);
    if (!live) continue; // deleted or hidden
    if (!live.dirty) {
      out.push(seg.text); // untouched -> verbatim
      continue;
    }
    emitHeaderOnce(); // template/clock header precedes the first regenerated field
    const shifted = dirtyShiftedById.get(seg.objectId);
    if (shifted && !isGroup(shifted)) out.push(emitFieldBody(shifted, emitCtx));
  }

  let result = out.join('');

  if (newShifted.length > 0) {
    const appendLines: string[] = [];
    if (!headerEmitted && headerLines.length > 0) appendLines.push(...headerLines);
    for (const o of newShifted) if (!isGroup(o)) appendLines.push(emitFieldBody(o, emitCtx));
    const block = appendLines.join('\n');
    // New fields go inside the block, just before ^XZ. ZPL command letters are
    // case-insensitive; check the common uppercase form first, then a regex on
    // the original for a rare lowercase terminator (matching the original keeps
    // slice indices accurate, unlike toUpperCase which can grow e.g. ß into SS).
    let idx = result.lastIndexOf('^XZ');
    if (idx < 0) idx = [...result.matchAll(/\^[xX][zZ]/g)].pop()?.index ?? -1;
    result =
      idx >= 0 ? `${result.slice(0, idx)}${block}\n${result.slice(idx)}` : `${result}\n${block}`;
  }

  const head = overlay.head;
  return { block: result, head: head && headMatches(result, head) ? head : undefined };
}

/** R: is volatile RAM, matches single-run batch scope. */
const BATCH_TEMPLATE_PATH = 'R:LBL.ZPL';

/** Store template via ^DF then emit one ^XA^XF...^XZ recall block per
 *  CSV row. Unmapped variables fall back to the template's ^FD default. */
export function generateBatchZpl(
  label: LabelConfig,
  objects: LabelObject[],
  variables: readonly Variable[],
  dataset: {
    headers: readonly string[];
    rows: readonly (readonly string[])[];
  },
  columnMapping: { bindings: Record<string, string> },
): string {
  const baseZpl = generateZPL(label, objects, variables);
  // Inject after first ^XA (not at start) because ~DY/~SD preambles
  // emit before ^XA and would skip a start-anchored match.
  const templateStored = baseZpl.replace(
    /\^XA\r?\n/,
    `^XA\n^DF${BATCH_TEMPLATE_PATH}\n`,
  );

  const identity = (s: string) => s;
  // Excluded leaves aren't in the stored template, so don't source a transform
  // from one (it could shadow an exported field sharing the same variable).
  const leaves = [...walkObjects(objects)].filter((o) => o.includeInExport !== false);
  const batchBuckets = fnConsumerBuckets(objects, variables);
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
      bound && !isGroup(bound) && !!boundEntry?.ctrlNeedsOwnEscape
      && !isGs1Active(boundEntry, bound.props) && plainSharedFns.has(v.fnNumber);
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

  const recallBlocks = dataset.rows.map((row) => {
    const lines: string[] = ['^XA', `^XF${BATCH_TEMPLATE_PATH}`];
    for (const { fn, colIdx, transform } of overrides) {
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

/** Subtract label home/top from each object so emit matches the editor, the
 *  inverse of the parser folding ^LH/^LT into absolute coords. Leaves whose
 *  emitted origin goes negative are dropped (Zebra rejects negative ^FO/^FT and
 *  clamping would relocate them silently). Identity when no shift applies. */
function shiftObjectsByHome(
  objects: LabelObject[],
  homeX: number,
  homeY: number,
  top: number,
  label: LabelConfig,
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
  label: LabelConfig,
  objects: LabelObject[],
  variables: readonly Variable[] = [],
): { headerLines: string[]; bodyLines: string[] } {
  const homeX = label.labelHomeX ?? 0;
  const homeY = label.labelHomeY ?? 0;
  const top = label.labelTop ?? 0;
  const shifted = shiftObjectsByHome(objects, homeX, homeY, top, label);

  const { headerLines, emitCtx } = planTemplateHeader(shifted, label, variables);

  // Groups are structural; includeInExport=false cascades to the subtree.
  // Byte-identical round-trip lives in the overlay path (emitOverlayPage); this
  // model generator always regenerates.
  const emitLeaf = (obj: LabelObject): string[] => {
    if (obj.includeInExport === false) return [];
    if (isGroup(obj)) return obj.children.flatMap(emitLeaf);
    return [emitFieldBody(obj, emitCtx)];
  };
  return { headerLines, bodyLines: shifted.flatMap(emitLeaf) };
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
  return generateZplBlock(label, objects, variables).block;
}

/** Model emit plus the format head it wrote. The head is exact by construction
 *  rather than searched for; the ^A@ aliasing at the end only rewrites body
 *  bytes, so the offsets survive it. */
function generateZplBlock(
  label: LabelConfig,
  objects: LabelObject[],
  variables: readonly Variable[] = [],
): PageBlock {
  // ^PW/^LL are consumed in physical head dots (ZD230-verified), even under
  // ^JMB: the body's object dots emit in the effective (halved) scale, but the
  // print width/length stay physical.
  const widthDots = mmToDots(label.widthMm, label.dpmm);
  const heightDots = mmToDots(label.heightMm, label.dpmm);

  const lines: string[] = [];

  // ~DY ships font bytes before ^XA so ^CW/^A resolve against them.
  for (const m of label.customFonts ?? []) {
    const line = formatDownloadObject(m);
    if (line) lines.push(line);
  }

  // ~DY graphic uploads deduped by path; body ^XG recalls them.
  const seenGraphics = new Set<string>();
  for (const obj of flattenObjects(objects)) {
    if (obj.type !== 'image') continue;
    const p = obj.props as ImageProps;
    if (!p.storedAs || !p._gfaCache) continue;
    // Recall-only: bytes uploaded out-of-band; ZPL only emits ^XG references.
    if (p.storedAs.embedInZpl === false) continue;
    const key = formatStoragePath(p.storedAs, false);
    if (seenGraphics.has(key)) continue;
    seenGraphics.add(key);
    const dy = formatGraphicUpload(p);
    if (dy) lines.push(dy);
  }

  // ~SD is immediate (not EEPROM), emit before ^XA so it applies to this label.
  if (label.instantDarkness !== undefined) {
    const v = String(label.instantDarkness).padStart(2, '0');
    lines.push(`~SD${v}`);
  }

  // ~JS is immediate/transient like ~SD; emit before ^XA.
  if (label.backfeedSequence) lines.push(`~JS${label.backfeedSequence}`);

  lines.push('^XA');
  // Offset just past the ^XA: every preceding line plus its newline.
  const headAt = lines.reduce((n, l) => n + l.length + 1, 0) - 1;
  // ^JM must precede the first ^FS (p269), and the sidecar comment below
  // already closes with one; emit it first.
  const jmSpans: JmSpan[] = [];
  if (label.jmDensity) {
    const jm = `^JM${label.jmDensity}`;
    jmSpans.push({ start: headAt + 1, end: headAt + 1 + jm.length, delim: ',', caret: '^' });
    lines.push(jm);
  }
  // Leading geometry sidecar: recovers exact width/height/dpmm on re-import,
  // which plain ^PW/^LL (dots, no dpmm) can't. A comment, so print is unaffected.
  lines.push(formatLabelMetaComment({
    dpmm: label.dpmm,
    widthMm: label.widthMm,
    heightMm: label.heightMm,
  }));
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
      if (f.alias && f.path) lines.push(`^CW${f.alias},${f.path}`);
    }
  }

  // ^CF f,h,w positional; trim trailing empty slots.
  if (
    label.defaultFontId ||
    label.defaultFontHeight !== undefined ||
    label.defaultFontWidth !== undefined
  ) {
    const slots = trimTrailingEmptySlots([
      label.defaultFontId ?? "",
      label.defaultFontHeight !== undefined ? String(label.defaultFontHeight) : "",
      label.defaultFontWidth !== undefined ? String(label.defaultFontWidth) : "",
    ]);
    lines.push(`^CF${slots.join(",")}`);
  }

  const { headerLines, bodyLines } = planFieldEmission(label, objects, variables);
  lines.push(...headerLines, ...bodyLines);

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

  return {
    block: aliasFontPaths(lines.join('\n'), label),
    head: { caret: '^', at: headAt, jmSpans },
  };
}

/** Rewrite `^A@…PATH` to `^A{alias}` for paths the user registered via `^CW`.
 *  Used only by the full model generator over its whole output; the overlay
 *  export deliberately does NOT alias (a regenerated direct-path ^A@ is valid
 *  and order-independent, avoiding a ^CW forward-reference). */
function aliasFontPaths(text: string, label: LabelConfig): string {
  const aliasByPath = new Map<string, string>();
  for (const m of label.customFonts ?? []) {
    if (m.alias && m.path) aliasByPath.set(m.path, m.alias);
  }
  if (aliasByPath.size === 0) return text;
  return text.replace(
    /\^A@([NIRB]),(\d+),(\d+),([A-Z]:[^^\n]+?)(?=\^|\n|$)/g,
    (full, rot, h, w, path) => {
      const alias = aliasByPath.get(path);
      return alias ? `^A${alias}${rot},${h},${w}` : full;
    },
  );
}
