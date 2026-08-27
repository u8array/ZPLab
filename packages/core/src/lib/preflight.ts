import { getEntry, gs1StaticUnparsed, isGs1Active, usesPlainCode128Escape, type LeafObject } from "../registry";
import {
  inkRunsLeftOfAnchor,
  objectBoundsDots,
  offLabelPlacement,
  type ObjectBoundsCtx,
} from "./objectBounds";
import { emittedAnchorDots } from "./emittedAnchor";
import { resolveDeviceFontId } from "./customFonts";
import { suspiciousCharDetail } from "./suspiciousChars";
import { GS1_GS, parseGs1ToSegments, typedGs1Parts, typedGs1Shape, validateGs1Segment, validateGs1SegmentResolved } from "./gs1";
import { DATAMATRIX_FD_ESCAPE, typedGs1ToDataMatrixFd } from "./dataMatrixFd";
import { gs1CarrierFor, planGs1Fd } from "./gs1Plan";
import { extractTemplateRefs, hasTemplateMarkers, pickEmbedChar } from "./fnTemplate";
import { hasClockMarkers, pickClockChars } from "./fcTemplate";
import { planCode128Fd, planHasLoss } from "./code128Plan";
import { resolveControlMarkers } from "../types/controlKey";
import { classifyField, isLoneMarker } from "./variableField";
import { parseContent, typedContentIncompleteRows, typedContentMarkerFindings } from "./typedContent";
import { getObjectStringContent, resolveForRow, variableSubstitutions } from "./variableBinding";
import { fnConsumerBuckets, isModeDLeaf } from "./gs1ModeDFns";
import { slotEncodingConflicts } from "./slotConflicts";
import { isPrintedBlank } from "./zebraTextLayout";
import { resolveTextMode } from "../registry/text";
import type { ColumnMapping, Variable } from "../types/Variable";
import type { Unit } from "./units";
import {
  PREFLIGHT_SEVERITY,
  type PreflightFinding,
  type PreflightKind,
  type PreflightSeverity,
} from "../types/preflight";

export { PREFLIGHT_SEVERITY };
export type { PreflightFinding, PreflightKind, PreflightSeverity };

/** Untouched-field grace: drop emptyContent findings for just-created,
 *  still-selected objects (store `pristineEmptyIds`) so the panel does not
 *  nag while the user is configuring what they just dropped. Every other
 *  kind passes through; the grace ends on first deselect. */
export function suppressPristineEmpty(
  findings: PreflightFinding[],
  pristineIds: readonly string[],
): PreflightFinding[] {
  if (pristineIds.length === 0) return findings;
  const pristine = new Set(pristineIds);
  return findings.filter((f) => f.kind !== "emptyContent" || !pristine.has(f.objectId));
}

interface MarkerValueDeps {
  variables: readonly Variable[];
  dataset: { headers: readonly string[]; rows: readonly (readonly string[])[] } | null;
  columnMapping: ColumnMapping | null;
}

// Per-leaf cache: the row-walk over a large CSV must not rerun every render.
// Deps are compared by identity (store state is immutable).
const markerValueCache = new WeakMap<
  LeafObject,
  MarkerValueDeps & { findings: PreflightFinding[] }
>();

/** Export-side warning for typed-content, GS1 and block-mode marker values:
 *  the builder's Apply gate only covers authoring time, so a later CSV
 *  re-import, mapping change or edited default surfaces here, where the
 *  warnings track what prints. */
export function markerValueFindings(
  leaves: readonly LeafObject[],
  deps: MarkerValueDeps,
): PreflightFinding[] {
  const out: PreflightFinding[] = [];
  const finding = (leaf: LeafObject, kind: "markerValueUnsafe" | "gs1ValueInvalid" | "markerArmFailed", detail?: string): PreflightFinding => ({
    objectId: leaf.id,
    kind,
    severity: PREFLIGHT_SEVERITY[kind],
    detail,
  });
  for (const leaf of leaves) {
    const content = getObjectStringContent(leaf);
    if (content === undefined || !hasTemplateMarkers(content)) continue;
    const leafEntry = getEntry(leaf.type);
    const gs1Data = isGs1Active(leafEntry, leaf.props);
    const typed = !gs1Data && !!leafEntry?.typedContent;
    const blockMode =
      !gs1Data && !typed && leaf.type === "text"
        ? resolveTextMode(leaf.props as Parameters<typeof resolveTextMode>[0])
        : null;
    const blockHazard = blockMode === "tb" ? "<" : blockMode === "fb" ? "\\" : null;
    if (!gs1Data && !typed && !blockHazard) continue;
    const hit = markerValueCache.get(leaf);
    if (
      hit &&
      hit.variables === deps.variables &&
      hit.dataset === deps.dataset &&
      hit.columnMapping === deps.columnMapping
    ) {
      out.push(...hit.findings);
      continue;
    }
    const findings: PreflightFinding[] = [];
    if (gs1Data) {
      if (isLoneMarker(content)) {
        // Single-bind: the runtime value IS the whole GS1 payload. The encode
        // badge already covers the ACTIVE substitution (defaults, or the
        // active row), so only the OTHER CSV rows need checking here; without
        // a dataset there is nothing the badge doesn't see.
        const rows = deps.dataset && deps.columnMapping ? deps.dataset.rows.map((_, i) => i) : [];
        const details: string[] = [];
        for (const rowIdx of rows) {
          const resolved = resolveForRow(content, rowIdx, deps.variables, deps.dataset, deps.columnMapping);
          const at = rowIdx < 0 ? "defaults" : `row ${rowIdx + 1}`;
          const segs = parseGs1ToSegments(resolved);
          if (segs === null || segs.length === 0) {
            details.push(`${at}: does not parse as GS1`);
          } else {
            for (const sg of segs) {
              const err = validateGs1Segment(sg.ai, sg.value);
              if (err) details.push(`${at}: (${sg.ai}) ${err}`);
            }
          }
          if (details.length >= 4) break;
        }
        if (details.length > 0) {
          findings.push(finding(leaf, "gs1ValueInvalid", details.slice(0, 3).join("; ") + (details.length > 3 ? "; …" : "")));
        }
      } else {
        const segments = parseGs1ToSegments(content, deps.variables);
        if (segments === null) {
          findings.push(finding(leaf, "gs1ValueInvalid", "variable widths no longer fit the AI structure"));
        } else {
          // Structure parses: validate every printing substitution (each CSV
          // row, else the defaults) per marker segment against the AI's
          // length/charset/date rules. The resolved value IS the runtime
          // value here, so an empty variable-AI value is a real error.
          // A 0-row dataset prints the defaults too, so validate them like the
          // no-dataset case rather than iterating an empty row set.
          const rows =
            deps.dataset && deps.columnMapping && deps.dataset.rows.length > 0
              ? deps.dataset.rows.map((_, i) => i)
              : [-1];
          const details: string[] = [];
          outer: for (const rowIdx of rows) {
            for (const seg of segments) {
              if (!hasTemplateMarkers(seg.value)) continue;
              const resolved = resolveForRow(seg.value, rowIdx, deps.variables, deps.dataset, deps.columnMapping);
              const at = rowIdx < 0 ? "defaults" : `row ${rowIdx + 1}`;
              const err = validateGs1SegmentResolved(seg.ai, seg.value, resolved, false);
              if (err) details.push(`${at}: (${seg.ai}) ${err}`);
              // GS1 DataMatrix: the ^BX escape char in a SUBSTITUTED value is
              // re-read as an escape sequence at print (FNC1 / de-doubling);
              // the literal-time doubling can't cover ^FN-inserted data. `_`
              // is a valid GS1 char, so the charset check won't catch it.
              if (leaf.type === "datamatrix" && resolved.includes(DATAMATRIX_FD_ESCAPE)) {
                details.push(`${at}: (${seg.ai}) "${DATAMATRIX_FD_ESCAPE}" collides with the ^BX escape character`);
              }
              if (details.length >= 4) break outer;
            }
          }
          if (details.length > 0) {
            findings.push(finding(leaf, "gs1ValueInvalid", details.slice(0, 3).join("; ") + (details.length > 3 ? "; …" : "")));
          }
        }
      }
    } else if (typed) {
      const parsed = parseContent(content);
      const errors = typedContentMarkerFindings(
        parsed.type, parsed.fields, deps.variables, deps.dataset, deps.columnMapping,
      );
      for (const [field, chars] of Object.entries(errors)) {
        findings.push(finding(leaf, "markerValueUnsafe", `${field}: ${chars}`));
      }
      const rows = typedContentIncompleteRows(
        parsed.type, parsed.fields, deps.variables, deps.dataset, deps.columnMapping,
      );
      if (rows.length > 0) {
        const shown = rows.slice(0, 5).join(", ") + (rows.length > 5 ? ", …" : "");
        findings.push(finding(leaf, "markerValueUnsafe", rows[0] === 0 ? "incomplete with defaults" : `incomplete rows: ${shown}`));
      }
    } else if (blockHazard && !isLoneMarker(content)) {
      // ^TB/^FB run their block escaping over literals at emit and over
      // single-bind values via encodeDefault/fdTransform, but a TEMPLATE slot
      // value is inserted raw at print, where a block-control char corrupts
      // the block. Shared ^FN slots make per-use escaping impossible, so warn.
      const byName = new Map(deps.variables.map((v) => [v.name, v]));
      const dirty: string[] = [];
      for (const name of new Set(extractTemplateRefs(content))) {
        const v = byName.get(name);
        if (!v) continue;
        if (variableSubstitutions(v, deps.dataset, deps.columnMapping).some((val) => val.includes(blockHazard))) {
          dirty.push(v.name);
        }
      }
      if (dirty.length > 0) {
        findings.push(finding(
          leaf,
          "markerValueUnsafe",
          `"${blockHazard}" in ${dirty.join(", ")} breaks the ^${blockMode === "tb" ? "TB" : "FB"} block`,
        ));
      }
    }
    markerValueCache.set(leaf, { ...deps, findings });
    out.push(...findings);
  }
  // ^FN slot-value checks (cross-leaf state, so outside the per-leaf cache):
  // shared slots emit raw; exclusive plain-^BC slots still leak `>` before an
  // invocation char, which the escape leaves verbatim by design.
  const byName = new Map(deps.variables.map((v) => [v.name, v]));
  // One CSV row-walk per variable per run, not per warning channel. The dirty
  // predicates get chip-RESOLVED values (their plans see bytes); the encoding
  // comparison gets RAW values (the emit transforms unresolved defaults).
  const subsCache = new Map<string, { raw: string[]; resolved: string[] }>();
  const subsOf = (v: Variable) => {
    let subs = subsCache.get(v.id);
    if (!subs) {
      const raw = variableSubstitutions(v, deps.dataset, deps.columnMapping);
      subs = { raw, resolved: raw.map(resolveControlMarkers) };
      subsCache.set(v.id, subs);
    }
    return subs;
  };
  const substitutionsOf = (v: Variable): string[] => subsOf(v).resolved;
  const slotValueWarnings = (
    slots: Set<number>,
    leafPred: (leaf: LeafObject) => boolean,
    dirtyPred: (val: string) => boolean,
    message: (names: string) => string,
  ) => {
    if (slots.size === 0) return;
    for (const leaf of leaves) {
      if (!leafPred(leaf)) continue;
      const content = getObjectStringContent(leaf);
      if (content === undefined || !hasTemplateMarkers(content)) continue;
      const dirty: string[] = [];
      for (const name of new Set(extractTemplateRefs(content))) {
        const v = byName.get(name);
        if (!v || !slots.has(v.fnNumber)) continue;
        if (substitutionsOf(v).some(dirtyPred)) {
          dirty.push(v.name);
        }
      }
      if (dirty.length > 0) {
        out.push(finding(leaf, "markerValueUnsafe", message(dirty.join(", "))));
      }
    }
  };
  const plainLeaf = (leaf: LeafObject) =>
    !!getEntry(leaf.type)?.ctrlNeedsOwnEscape && !isModeDLeaf(leaf);
  const buckets = fnConsumerBuckets(leaves, deps.variables);
  slotValueWarnings(
    buckets.modeDShared,
    isModeDLeaf,
    (val) => val.includes(">"),
    (names) => `">" in ${names} prints as an invocation code (slot shared with a non-GS1 field)`,
  );
  // Plain-^BC value channels: the LEAF shape picks the plan mode, the loss
  // kind picks the message. Known over-warn on mixed slots' template leaf
  // (the single-bind emit carries the invocation form there).
  const c0Message = (names: string) =>
    `control bytes in ${names} are dropped from the printed symbol (^FH path)`;
  slotValueWarnings(
    buckets.plainShared,
    plainLeaf,
    (val) => planHasLoss(planCode128Fd(val, "sharedRaw"), "rawUnescaped"),
    (names) => `">", "^" or "~" in ${names} corrupts the symbol (shared ^FN slot emits unescaped)`,
  );
  slotValueWarnings(
    buckets.plainShared,
    plainLeaf,
    (val) => planHasLoss(planCode128Fd(val, "sharedRaw"), "controlBytesDropped"),
    c0Message,
  );
  // No value predicate: divergence is already decided per value in slotEncodingConflicts.
  const conflicts = slotEncodingConflicts(leaves, deps.variables, (v) => subsOf(v).raw, buckets);
  slotValueWarnings(
    conflicts.fns,
    (leaf) => conflicts.consumerIds.has(leaf.id),
    () => true,
    (names) => `${names} is bound by fields that encode it differently: every consumer prints the encoding of the field that emits the slot`,
  );
  // Exclusive slots: a lone bind is a whole ^FD (invocation form covers
  // control bytes AND protects `>`+invocation sequences by encoding them);
  // a template value keeps ^FH and ships the sequences verbatim.
  const invMessage = (names: string) =>
    `">" before an invocation character in ${names} prints as a barcode invocation, not text`;
  const templateLeaf = (leaf: LeafObject) =>
    plainLeaf(leaf) && !isLoneMarker(getObjectStringContent(leaf) ?? "");
  const loneLeaf = (leaf: LeafObject) =>
    plainLeaf(leaf) && isLoneMarker(getObjectStringContent(leaf) ?? "");
  slotValueWarnings(
    buckets.plainExclusive,
    templateLeaf,
    (val) => planHasLoss(planCode128Fd(val, "templateValue"), "invocationRead"),
    invMessage,
  );
  slotValueWarnings(
    buckets.plainExclusive,
    loneLeaf,
    (val) => planHasLoss(planCode128Fd(val, "whole"), "invocationRead"),
    invMessage,
  );
  slotValueWarnings(
    buckets.plainExclusive,
    templateLeaf,
    (val) => planHasLoss(planCode128Fd(val, "templateValue"), "controlBytesDropped"),
    c0Message,
  );
  slotValueWarnings(
    buckets.plainExclusive,
    loneLeaf,
    (val) => planHasLoss(planCode128Fd(val, "whole"), "controlBytesDropped"),
    c0Message,
  );
  // Exhausted ^FC/^FE candidate sets arm nothing at export: markers ship as
  // literal text. Mirror planTemplateHeader's scan exactly (skip only KNOWN
  // single-binds; include the chars the plain-^BC escape injects).
  const inScan = (c: string) => classifyField(c, deps.variables).kind !== "single";
  // Chips-only payloads arm no ^FE, so they neither constrain nor warn.
  const armsFe = (c: string) => hasTemplateMarkers(resolveControlMarkers(c));
  const clockPayloads: string[] = [];
  const templatePayloads: string[] = [];
  for (const leaf of leaves) {
    const c = getObjectStringContent(leaf);
    if (c === undefined || !inScan(c)) continue;
    const scan = plainLeaf(leaf) ? planCode128Fd(c, "template").fd : c;
    if (armsFe(c)) templatePayloads.push(scan);
    if (hasClockMarkers(c)) clockPayloads.push(scan);
  }
  const embedsDead = templatePayloads.length > 0 && pickEmbedChar(templatePayloads) === null;
  const clocksDead = clockPayloads.length > 0 && pickClockChars(clockPayloads) === null;
  if (embedsDead || clocksDead) {
    for (const leaf of leaves) {
      const c = getObjectStringContent(leaf);
      if (c === undefined || !inScan(c)) continue;
      if ((embedsDead && armsFe(c)) || (clocksDead && hasClockMarkers(c))) {
        out.push(finding(leaf, "markerArmFailed"));
      }
    }
  }
  return out;
}

/** Current preflight findings for a page's leaves. Pass the EXPORTABLE leaves
 *  (includeInExport, not editor visibility) so the warnings track what actually
 *  prints. Pure projection of the document, recomputed as geometry and measured
 *  footprints settle. Runs the geometry (off-label) producer plus each type's
 *  own `preflight` producer (block-too-narrow, barcode module too small). */
export function computePreflight(
  leaves: readonly LeafObject[],
  ctx: ObjectBoundsCtx,
  unit: Unit,
): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const leaf of leaves) {
    // An unregistered type has no emitter/bounds producer, so it prints
    // nothing; flag it and skip the checks that dereference the entry.
    if (getEntry(leaf.type) === undefined) {
      findings.push({ objectId: leaf.id, kind: "unknownType", severity: PREFLIGHT_SEVERITY.unknownType });
      continue;
    }
    const content = getObjectStringContent(leaf);
    const box = objectBoundsDots(leaf, ctx);
    const textProps = leaf.type === "text"
      ? (leaf.props as { fontId?: string; printerFontName?: string })
      : undefined;
    const deviceFontId = textProps
      ? resolveDeviceFontId(textProps.fontId, textProps.printerFontName, ctx.label)
      : undefined;
    // A printed-blank text field draws a placeholder but emits nothing
    // visible: skip off-label here, the emptyContent check below owns the
    // blank-field signal.
    const blankText =
      leaf.type === "text" && content !== undefined && isPrintedBlank(content, deviceFontId);
    if (!blankText) {
      const placement = offLabelPlacement(
        emittedAnchorDots(leaf, ctx, box),
        box,
        ctx.label,
        inkRunsLeftOfAnchor(leaf),
      );
      const kind =
        placement === "outside" ? "offLabelOutside" : placement === "clipped" ? "offLabelClipped" : null;
      if (kind) findings.push({ objectId: leaf.id, kind, severity: PREFLIGHT_SEVERITY[kind] });
    }

    const produce = getEntry(leaf.type)?.preflight;
    if (produce) {
      for (const r of produce(leaf, { label: ctx.label, unit })) {
        findings.push({ objectId: leaf.id, kind: r.kind, severity: PREFLIGHT_SEVERITY[r.kind], detail: r.detail });
      }
    }

    // Cross-cutting: any content-bearing field (text, every barcode) can carry
    // invisible/ambiguous chars smuggled in via scan or foreign-tool import, so
    // check here once instead of duplicating the producer across every type.
    if (content !== undefined) {
      // GS1 fields carry a structural GS separator (0x1D) between chained AIs,
      // and a MaxiCode carrier message (modes 2/3 only; 5 is plain EEC data)
      // is GS-delimited by spec; intentional, not smuggled, so drop GS first.
      const leafEntry = getEntry(leaf.type);
      const gs1 = isGs1Active(leafEntry, leaf.props);
      if (gs1StaticUnparsed(leaf.type, leaf.props, content)) {
        findings.push({
          objectId: leaf.id,
          kind: "gs1ContentUnparsed",
          severity: PREFLIGHT_SEVERITY.gs1ContentUnparsed,
          detail: "the printer receives the content verbatim",
        });
      }
      const gsStructural =
        gs1 ||
        (leaf.type === "maxicode" && [2, 3].includes((leaf.props as { mode?: number }).mode ?? 0));
      const scanned = gsStructural ? content.split(GS1_GS).join("") : content;
      let detail = suspiciousCharDetail(scanned);
      // Plain ^BC: read the emit plan's losses for this content. Serial is
      // excluded: the ^SN seed is filtered to alphanumerics anyway. Known
      // gap: an unencodable byte without any C0 (e.g. DEL plus Ä) drops
      // silently; C0_RE keys the drop loss, DEL alone is routing, not loss.
      const p = leaf.props as { serial?: unknown };
      if (usesPlainCode128Escape(leafEntry, leaf.props) && !p.serial) {
        const templateFd = hasTemplateMarkers(resolveControlMarkers(content));
        const plan = planCode128Fd(content, templateFd ? "template" : "whole");
        for (const loss of plan.losses) {
          const msg = loss.kind === "invocationRead"
            ? `${loss.seqs.map((s) => `"${s}"`).join(", ")} read as barcode invocation codes, not text`
            : templateFd
              ? "control bytes in a template field are dropped from the printed symbol"
              : "control bytes are dropped from the printed symbol (payload has a character Code 128 cannot encode)";
          detail = detail ? `${detail}; ${msg}` : msg;
        }
      }
      if (detail) {
        // Hidden chars win over emptiness: NBSP/BOM-only content trims to empty
        // but carries invisible ink, so name it rather than call the field blank.
        findings.push({
          objectId: leaf.id,
          kind: "suspiciousChars",
          severity: PREFLIGHT_SEVERITY.suspiciousChars,
          detail,
        });
      } else if (
        leaf.type === "text" ? isPrintedBlank(content, deviceFontId) : content.trim() === ""
      ) {
        // Markers survive the check (case folding protects them), so bound and
        // template fields never fire here; a blank literal, serial seed or a
        // case-folded-empty device-font field is the state that prints a gap.
        findings.push({
          objectId: leaf.id,
          kind: "emptyContent",
          severity: PREFLIGHT_SEVERITY.emptyContent,
        });
      }
    }
  }
  return findings;
}

/** Data characters only: the AI catalog's canonical form differs from the
 *  caller's in punctuation, never in payload. */
const gs1DataChars = (s: string): string =>
  s.replaceAll("(", "").replaceAll(")", "").replaceAll(GS1_GS, "");

/** The catalog silently normalizes what it can parse: a 13-digit GTIN grows a
 *  computed check digit, stray characters vanish. Rewriting caller data without
 *  a word is worse than refusing it, so the difference is reported. */
export function gs1NormalizationFindings(leaves: readonly LeafObject[]): PreflightFinding[] {
  const out: PreflightFinding[] = [];
  for (const leaf of leaves) {
    const carrier = gs1CarrierFor(leaf.type);
    if (!carrier || (leaf.props as { gs1?: boolean }).gs1 === false) continue;
    if (leaf.type !== "gs1databar" && !(leaf.props as { gs1?: boolean }).gs1) continue;
    const content = getObjectStringContent(leaf) ?? "";
    if (content === "") continue;
    // ^BR ships the content verbatim on every path (no fd transform), so
    // neither a rewrite nor a derivability demand ever applies to it; a
    // canvas-vs-wire GTIN divergence is mirror-drift work.
    if (carrier === "databar") continue;
    if (hasTemplateMarkers(content)) {
      // A whole-field binding is canonical: the row supplies the entire element
      // string, so there is no structure to derive.
      if (!isLoneMarker(content)) {
        const shape = typedGs1Shape(content);
        // ^BX has to remove the parentheses itself and place every FNC1, so it
        // needs the catalog; ^BC mode D strips them in firmware and needs it
        // only to separate one AI from the next.
        const derivable =
          carrier === "datamatrix"
            ? typedGs1ToDataMatrixFd(content) !== null
            : shape !== null && (shape.length === 1 || typedGs1Parts(content) !== null);
        if (!derivable) {
          out.push({
            objectId: leaf.id,
            kind: "gs1ValueInvalid",
            severity: PREFLIGHT_SEVERITY.gs1ValueInvalid,
            detail:
              shape === null
                ? "GS1 content with a variable must be written as (AI)value"
                : "an AI here is not in the catalog, so the separator after it cannot be placed",
          });
        }
      }
      continue;
    }
    const canonical = planGs1Fd(content, carrier).bwipText;
    if (gs1DataChars(canonical) === gs1DataChars(content)) continue;
    out.push({
      objectId: leaf.id,
      kind: "gs1ValueInvalid",
      severity: PREFLIGHT_SEVERITY.gs1ValueInvalid,
      detail: `the payload was rewritten to ${canonical}`,
    });
  }
  return out;
}

/** The ZPL guide's ^FE list (p. 192) is a guarantee floor, not proof other
 *  firmware ignores it: hence "spec-guaranteed", never "only". */
const FE_PRINTERS = "ZD421C/D, ZD621D/T, ZT411/421, ZT510, ZT610/620";

/** Fields mixing literal text with variable slots have no wire form other
 *  than ^FE, which not every firmware resolves; a whole-field binding emits
 *  plain ^FN and is unaffected. */
export function templateFieldFindings(
  leaves: readonly LeafObject[],
  variables: readonly Variable[],
): PreflightFinding[] {
  const out: PreflightFinding[] = [];
  for (const leaf of leaves) {
    const content = getObjectStringContent(leaf);
    if (content === undefined) continue;
    const field = classifyField(content, variables);
    // refs empty means no marker names a variable (clock token, control chip,
    // orphan): markersToEmbeds arms no ^FE for any of those.
    if (field.kind !== "template" || field.refs.length === 0) continue;
    out.push({
      objectId: leaf.id,
      kind: "printerSupportLimited",
      severity: PREFLIGHT_SEVERITY.printerSupportLimited,
      detail: `mixed text and variables emit ^FE (spec-guaranteed on ${FE_PRINTERS})`,
    });
  }
  return out;
}
