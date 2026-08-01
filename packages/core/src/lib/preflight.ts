import { getEntry, type LeafObject } from "../registry";
import { objectBoundsDots, offLabelPlacement, type ObjectBoundsCtx } from "./objectBounds";
import { emittedAnchorDots } from "./emittedAnchor";
import { suspiciousCharDetail } from "./suspiciousChars";
import { GS1_GS, parseGs1ToSegments, validateGs1Segment, validateGs1SegmentResolved } from "./gs1";
import { DATAMATRIX_FD_ESCAPE } from "./dataMatrixFd";
import { extractTemplateRefs, hasTemplateMarkers, pickEmbedChar } from "./fnTemplate";
import { hasClockMarkers, pickClockChars } from "./fcTemplate";
import { code128EscapeLiterals } from "./code128Subset";
import { hasControlMarkers, resolveControlMarkers } from "../types/controlKey";
import { classifyField, isLoneMarker } from "./variableField";
import { parseContent, typedContentIncompleteRows, typedContentMarkerFindings } from "./typedContent";
import { getObjectStringContent, resolveForRow, variableSubstitutions } from "./variableBinding";
import { fnConsumerBuckets, isModeDLeaf } from "./gs1ModeDFns";
import { isBlankText } from "./zebraTextLayout";
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
    const gs1Data = (leaf.props as { gs1?: boolean }).gs1 === true || leaf.type === "gs1databar";
    const typed = !gs1Data && !!getEntry(leaf.type)?.typedContent;
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
        if (variableSubstitutions(v, deps.dataset, deps.columnMapping).some(dirtyPred)) {
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
  slotValueWarnings(
    buckets.plainShared,
    plainLeaf,
    // Not the escape delta: a `>` before an invocation char is unfixable by
    // escaping yet still corrupts (swallow / subset switch), so flag every >^~.
    (val) => /[>^~]/.test(val),
    (names) => `">", "^" or "~" in ${names} corrupts the symbol (shared ^FN slot emits unescaped)`,
  );
  slotValueWarnings(
    buckets.plainExclusive,
    plainLeaf,
    (val) => />[0-9:;<=]/.test(val),
    (names) => `">" before an invocation character in ${names} prints as a barcode invocation, not text`,
  );
  // eslint-disable-next-line no-control-regex
  const hasC0 = (val: string) => /[\x00-\x1F]/.test(val);
  const c0Message = (names: string) =>
    `control bytes in ${names} are dropped from the printed symbol (^FH path)`;
  // Exclusive slots: only a lone bind encodes control bytes losslessly
  // (invocation form); a template keeps ^FH where the firmware drops them.
  slotValueWarnings(
    buckets.plainExclusive,
    (leaf) => plainLeaf(leaf) && !isLoneMarker(getObjectStringContent(leaf) ?? ""),
    hasC0,
    c0Message,
  );
  // Shared slots emit raw/^FH even for a lone bind, so no exemption there.
  slotValueWarnings(
    buckets.plainShared,
    plainLeaf,
    hasC0,
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
    const scan = plainLeaf(leaf) ? code128EscapeLiterals(c) : c;
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
    // A blank text field draws a placeholder (its bounds) but emits an empty
    // ^FD, so it prints nothing: skip off-label here, the emptyContent check
    // below owns the blank-field signal.
    const blankText = leaf.type === "text" && content !== undefined && isBlankText(content);
    if (!blankText) {
      const placement = offLabelPlacement(emittedAnchorDots(leaf, ctx, box), box, ctx.label);
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
      const gsStructural =
        (leaf.props as { gs1?: boolean }).gs1 ||
        (leaf.type === "maxicode" && [2, 3].includes((leaf.props as { mode?: number }).mode ?? 0));
      const scanned = gsStructural ? content.split(GS1_GS).join("") : content;
      let detail = suspiciousCharDetail(scanned);
      // Plain ^BC: `>` before an invocation char stays verbatim (escaping it
      // would corrupt imported streams), so the firmware reads an invocation.
      // Serial excluded: the ^SN seed is filtered to alphanumerics anyway.
      const p = leaf.props as { gs1?: boolean; serial?: unknown };
      if (getEntry(leaf.type)?.ctrlNeedsOwnEscape && !p.gs1 && !p.serial) {
        const invocations = content.match(/>[0-9:;<=]/g);
        if (invocations) {
          const inv = `${[...new Set(invocations)].map((s) => `"${s}"`).join(", ")} read as barcode invocation codes, not text`;
          detail = detail ? `${detail}; ${inv}` : inv;
        }
        // Chips alongside other markers keep the lossy ^FH path (emitter
        // gate), where the firmware drops the bytes from the symbol.
        if (hasControlMarkers(content) && hasTemplateMarkers(resolveControlMarkers(content))) {
          const chips = "control chips in a template field are dropped from the printed symbol";
          detail = detail ? `${detail}; ${chips}` : chips;
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
      } else if (content.trim() === "") {
        // Raw content on purpose: markers make content non-empty, so bound and
        // template fields never fire here; a blank literal (or serial seed) is
        // the never-configured state that prints a gap.
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
