import type { CustomFontMapping } from "../../../types/LabelConfig";
import { FN_NUMBER_MAX, FN_NUMBER_MIN } from "../../../types/Variable";
import { applySerialToLeaf } from "../../../registry/serialField";
import { getEntry } from "../../../registry";
import { classifyField } from "../../variableField";
import { ZPL_BUILTIN_FONT_LETTERS } from "../../customFonts";
import {
  getDefaultTextH,
  getDefaultTextW,
  resetFieldBlockDefaults,
  type ParserState,
} from "../context";
import { acceptsPrefixRemap, ciToEncoding, dotsFor, getDecoder, int, readJustify, readRotation } from "../helpers";
import type { Handler, Wildcard } from "../types";

/** flushField + appendComment are shared with the orchestrator. */
export interface FieldHelpers {
  flushField: () => void;
  appendComment: Handler;
}

/** ^A{font}{rotation},{height},{width}: dynamic font (A0/A@ are
 *  static-mapped). Registered as a `Wildcard` because the font char
 *  is the variable part of the command name. */
export function createDynamicFontAWildcard(s: ParserState): Wildcard {
  const { dots } = dotsFor(s);
  return {
    matches: (cmd) => cmd.length === 2 && cmd[0] === "A",
    handle: (p, rest, cmd) => {
      s.field.fieldType = "text";
      s.field.textRot = readRotation(rest[0], s.defaults.fwRotation);
      s.field.textH = dots(p[1], getDefaultTextH(s.defaults));
      s.field.textW = dots(p[2], getDefaultTextW(s.defaults));
      const fontChar = cmd[1] ?? "";
      // Round-trip: ^A{id} matching the active ^CF drops to "use
      // default" (no pendingFontId) so re-emit stays terse; otherwise
      // pin the alias.
      if (s.defaults.cfFontId && fontChar === s.defaults.cfFontId) {
        s.field.pendingFontId = undefined;
      } else {
        s.field.pendingFontId = fontChar;
      }
      if (
        !s.fonts.aliases.has(fontChar) &&
        !ZPL_BUILTIN_FONT_LETTERS.includes(fontChar)
      ) {
        s.result.partialCmds.add(`^${cmd}`);
      }
    },
  };
}

/** Field-shaping commands: FO/FT, A0/A@, TB, CF, FW, FB, FH, FD/FS,
 *  LR/FR, LH/LT, SN/SF, FN/FC/FE, CI, FX, CW. */
export function createFieldHandlers(
  s: ParserState,
  helpers: FieldHelpers,
): Record<string, Handler> {
  const { flushField, appendComment } = helpers;
  const { labelConfig } = s.result;
  const { dots, dotsOrUndef } = dotsFor(s);

  // Shared by ^FD and ^FV (data-equivalent per spec).
  const setFieldData = (rest: string) => {
    // Implicit text field unless we're inside a bare `^FN^FD^FS` declaration.
    if (!s.field.fieldType && s.comment.fnNumber === null) {
      s.field.fieldType = "text";
      s.field.textH = getDefaultTextH(s.defaults);
      s.field.textW = getDefaultTextW(s.defaults);
      s.field.textRot = s.defaults.fwRotation;
    }
    s.field.pendingFD = rest;
  };

  return {
    // ── Field origin ──────────────────────────────────────────────────────
    FO(p) {
      flushField();
      s.field.x = dots(p[0]) + s.label.lhX;
      s.field.y = dots(p[1]) + s.label.lhY + s.label.ltY;
      s.field.justify = readJustify(p[2], s.defaults.fwJustify);
      s.field.positionIsFT = false;
    },
    FT(p) {
      flushField();
      s.field.x = dots(p[0]) + s.label.lhX;
      s.field.y = dots(p[1]) + s.label.lhY + s.label.ltY;
      s.field.justify = readJustify(p[2], s.defaults.fwJustify);
      s.field.positionIsFT = true;
    },

    // ── Text ──────────────────────────────────────────────────────────────
    // ^A0{rotation},{height},{width}  e.g. ^A0N,30,0
    A0(p, rest) {
      s.field.fieldType = "text";
      s.field.textRot = readRotation(rest[0], s.defaults.fwRotation);
      s.field.textH = dots(p[1], getDefaultTextH(s.defaults));
      s.field.textW = dots(p[2], getDefaultTextW(s.defaults));
      // fontId "0" only when ^CF differs; "0" is the implicit default otherwise.
      s.field.pendingFontId = s.defaults.cfFontId && s.defaults.cfFontId !== "0" ? "0" : undefined;
    },

    // ── Change alphanumeric default font ──────────────────────────────────
    // ^CF{font},{height},{width}  → sets default for fields without ^A
    CF(p) {
      const fontId = (p[0] ?? "").trim();
      // No fallback: a missing height/width leaves the current default.
      const cfH = dotsOrUndef(p[1]);
      if (cfH !== undefined) {
        s.defaults.cfHeight = cfH;
        if (cfH > 0) labelConfig.defaultFontHeight = cfH;
      }
      const cfW = dotsOrUndef(p[2]);
      if (cfW !== undefined) {
        s.defaults.cfWidth = cfW;
        if (cfW >= 0) labelConfig.defaultFontWidth = cfW;
      }
      if (fontId) {
        labelConfig.defaultFontId = fontId;
        s.defaults.cfFontId = fontId;
      }
    },

    // ── Field-wide defaults ───────────────────────────────────────────────
    // ^FW{rotation},{z}  e.g. ^FWR or ^FWN,1
    FW(p, rest) {
      const fw = (rest[0] ?? "N").toUpperCase();
      if (fw === "N" || fw === "R" || fw === "I" || fw === "B") {
        s.defaults.fwRotation = fw;
      }
      // z sets the default justification for ^FO/^FT that omit their own z;
      // 2 (auto) resets to L, same collapse readJustify applies per field.
      const z = p[1]?.trim();
      if (z === "0" || z === "1" || z === "2") s.defaults.fwJustify = z === "1" ? "R" : "L";
    },

    // ── Field block ───────────────────────────────────────────────────────
    // ^FB{width},{lines},{lineSpacing},{justify},{hangingIndent}
    FB(p) {
      s.defaults.fbWidth = dots(p[0]);
      s.defaults.fbLines = int(p[1], 1);
      s.defaults.fbSpacing = dots(p[2]);
      const fbJ = (p[3] ?? "L").toUpperCase();
      s.defaults.fbJustify = fbJ === "C" || fbJ === "R" || fbJ === "J" ? fbJ : "L";
      // Negative indent observed to clamp to 0 on Labelary; mirror that.
      s.defaults.fbHangingIndent = Math.max(0, dots(p[4]));
      // ^FB also implies text if no ^A was specified.
      if (!s.field.fieldType) {
        s.field.fieldType = "text";
        s.field.textH = getDefaultTextH(s.defaults);
        s.field.textW = getDefaultTextW(s.defaults);
        s.field.textRot = s.defaults.fwRotation;
      }
    },

    // ── Field hex indicator ───────────────────────────────────────────────
    FH(_, rest) {
      s.format.fhActive = true;
      s.format.fhDelimiter = rest[0] ?? "_";
    },

    // ── Field data / separator ────────────────────────────────────────────
    FD(_, rest) {
      setFieldData(rest);
    },
    // ^FV: data-equivalent of ^FD for variable fields (spec p.207; the only
    // delta is print-time clearing under ^MC reuse, which we don't model).
    // Re-emits as ^FD. An empty ^FV is ignored per spec.
    FV(_, rest) {
      if (rest) setFieldData(rest);
    },
    FS() {
      flushField();
      s.format.fhActive = false;
      s.field.positionIsFT = false;
      // Drop any per-field pending state that flushField left intact.
      // Each of these binds only to the field this ^FS closes; without
      // an explicit reset at the boundary a bare ^XX^FS (no ^FD) would
      // leak the pending value into the next real field.
      s.field.feArmed = false;
      s.field.fcArmed = false;
      s.field.snPending = false;
      s.field.snIncrement = 1;
      s.field.snMode = "SN";
      s.field.pendingPrinterFontName = undefined;
      s.field.pendingFontId = undefined;
      s.field.frActive = false;
      s.field.fpDirection = "H";
      s.field.fpCharGap = 0;
      s.field.gsMagnification = undefined;
      // Spec: an omitted z falls back to ^FW, never to the PRIOR field's z, so
      // a position-command-less follow field must not inherit the leaked R.
      s.field.justify = s.defaults.fwJustify;
      resetFieldBlockDefaults(s.defaults);
      s.comment.fnNumber = null;
      s.comment.fnComment = undefined;
    },

    // ── Serialization ─────────────────────────────────────────────────────
    SN(p) {
      // ^SN{start},{increment},{leadZero} appears in two placements: inside the
      // field (our generator's shape and the spec's ^FO..^A..^SN..^FS, where
      // ^SN both seeds and serializes), or after ^FS (upgrades the just-flushed
      // field). Handle both so a serial field always round-trips.
      const snStart = p[0] ?? "";
      const snInc = int(p[1], 1);
      if (s.field.fieldType) {
        s.field.snPending = true;
        s.field.snIncrement = snInc;
        s.field.snMode = "SN";
        // ^SN's explicit start value is the seed and overrides any prior ^FD,
        // consistent with the post-^FS path, but only for a field that will
        // actually serialise (text/1D). On a non-serialisable type the ^SN is
        // dropped at flush, so don't corrupt its ^FD / variable default. An empty
        // start (^SN,1,Y) keeps the ^FD, or seeds empty when there is none so an
        // empty-seed serial still survives (the pendingFD===null guard).
        const serialisable = !!getEntry(s.field.fieldType)?.serialisable;
        if (snStart && serialisable) s.field.pendingFD = snStart;
        else if (s.field.pendingFD === null) s.field.pendingFD = snStart;
        return;
      }
      const lastObj = s.result.objects[s.result.objects.length - 1];
      // Only types whose emitter emits ^SN/^SF (text + 1D) take a serial; a
      // 2D/stacked field would import a state the emitter drops on export.
      if (lastObj && getEntry(lastObj.type)?.serialisable) {
        const cur = (lastObj as { props: { content?: string } }).props.content ?? "";
        const cls = classifyField(cur, s.result.variables);
        if (cls.kind === "single") {
          // Serial wins over a single-bind: replace the «name» marker with a
          // literal seed (the ^SN start, else the bound default), so export
          // serialises a real value instead of a charset-filtered marker.
          (lastObj as { props: { content?: string } }).props.content = snStart || cls.variable.defaultValue;
          // That may have been the variable's only reference, but a later
          // field or embed can still re-reference the shared slot, so the
          // orphan decision is deferred to end of parse.
          s.serialStrippedFns.add(cls.variable.fnNumber);
        } else if (snStart) {
          // ^SN's explicit start value is the serial seed and overrides any prior
          // ^FD payload, for text and 1D barcodes alike: the emitter re-emits the
          // seed from `content` (no ^FD in SN mode), so keeping the stale ^FD
          // would silently rewrite the ZPL on the next export. An empty start
          // (`^SN,1,Y`) leaves the ^FD as the seed.
          (lastObj as { props: { content?: string } }).props.content = snStart;
        }
        applySerialToLeaf(lastObj, { increment: snInc, zplMode: "SN" });
      }
    },
    SF(p) {
      // ^SFa,b: a=mask (derived from the seed on emit, ignored here), b=increment
      // string. We model only the decimal increment; a complex/aligned mask is
      // not round-tripped (regenerated from the seed). Pairs with the field's ^FD.
      s.field.snPending = true;
      s.field.snIncrement = int(p[1], 1);
      s.field.snMode = "SF";
    },

    // ── Label reverse / field reverse ─────────────────────────────────────
    LR(_, rest) {
      s.label.lrActive = rest.toUpperCase().startsWith("Y");
    },
    FR() {
      s.field.frActive = true;
    },

    // ── Field-direction modifier (CJK vertical / RTL reverse) ─────────────
    // ^FP{d},{g}  d ∈ H|V|R, g = inter-char gap in dots (default 0).
    // Per-field; ^FS resets back to H/0. Gap is clamped to the spec's
    // 0..9999 range so a malformed import can't corrupt the prop.
    FP(p) {
      const d = (p[0] ?? "H").toUpperCase();
      s.field.fpDirection = d === "V" || d === "R" ? d : "H";
      s.field.fpCharGap = Math.max(0, Math.min(9999, dots(p[1])));
    },

    // ── Label home (origin offset) ────────────────────────────────────────
    LH(p) {
      s.label.lhX = dots(p[0]);
      s.label.lhY = dots(p[1]);
    },

    // ── Label top (vertical offset) ───────────────────────────────────────
    LT(_, rest) {
      s.label.ltY = dots(rest);
    },

    // ^CW {alias},{path}: register a printer-resident font alias.
    // Upsert: later ^CW for same alias replaces, no duplicates.
    CW(p) {
      const alias = (p[0] ?? "").trim().toUpperCase();
      const path = (p[1] ?? "").trim();
      if (!/^[A-Z0-9]$/.test(alias) || !path) return;
      s.fonts.aliases.set(alias, path);
      const list = (labelConfig.customFonts ?? []).filter(
        (m) => m.alias !== alias,
      );
      const entry: CustomFontMapping = { alias, path };
      if (s.fonts.downloadedFontPaths.has(path)) {
        // Bytes shipped via ~DY earlier, mark for re-emit and link the fontCache key.
        entry.embedInZpl = true;
        const colonIdx = path.indexOf(":");
        const filename = colonIdx >= 0 ? path.slice(colonIdx + 1) : path;
        if (filename) entry.previewFontName = filename;
      }
      labelConfig.customFonts = [...list, entry];
    },

    // ── TrueType font / text block ────────────────────────────────────────
    // ^A@{rotation},{height},{width},{drive}:{font}: TrueType font reference.
    // Can't load printer TrueType fonts, import as text with best-effort sizing.
    "A@"(p, rest) {
      s.field.fieldType = "text";
      s.field.textRot = readRotation(rest[0], s.defaults.fwRotation);
      s.field.textH = dots(p[1]) || getDefaultTextH(s.defaults);
      s.field.textW = dots(p[2]) || getDefaultTextW(s.defaults);
      const fontRef = p[3] ?? "";
      const colonIdx = fontRef.indexOf(":");
      s.field.pendingPrinterFontName =
        (colonIdx >= 0 ? fontRef.slice(colonIdx + 1) : fontRef) || undefined;
      // A direct path here claims an uploaded font without a ^CW alias;
      // record it so the import won't mistake it for a Setup-Script font.
      const fontRefTrimmed = fontRef.trim();
      if (fontRefTrimmed) s.fonts.referencedFontPaths.add(fontRefTrimmed);
      s.result.partialCmds.add("^A@");
    },
    // ^TB{rotation},{width},{height}: text block. Stored natively (width +
    // clip height) so it round-trips as ^TB, unlike the prior lossy collapse
    // to ^FB lines. Justify/spacing/indent are not ^TB params.
    TB(p, rest) {
      s.field.fieldType = "text";
      s.field.textRot = readRotation(rest[0], s.defaults.fwRotation);
      const tbW = dots(p[1]);
      const tbH = dots(p[2]);
      s.field.textH = getDefaultTextH(s.defaults);
      s.field.textW = getDefaultTextW(s.defaults);
      // Spec defaults width/height to 1 dot; clamp (never drop) so even a bare
      // ^TB round-trips as ^TB instead of silently degrading to plain text.
      s.defaults.fbWidth = tbW > 0 ? tbW : 1;
      s.defaults.tbHeight = tbH > 0 ? tbH : s.field.textH;
    },

    FX: appendComment,

    // ^CI N: character set / encoding for ^FH byte decoding. Mapped to a
    // TextDecoder; unsupported variants (UTF-16/32, code page 850) keep the
    // current decoder and surface as a partial import.
    CI(p) {
      const enc = ciToEncoding(int(p[0]));
      s.format.fhDecoder = getDecoder(enc.label);
      if (!enc.supported) s.result.partialCmds.add(`^CI${int(p[0])}`);
    },

    // ^FN{n}: template slot for the next field's ^FD default. Out-of-range ignored.
    FN(p) {
      const n = int(p[0]);
      if (n < FN_NUMBER_MIN || n > FN_NUMBER_MAX) {
        s.result.partialCmds.add("^FN");
        return;
      }
      s.result.sourceFnNumbers.add(n);
      s.comment.fnNumber = n;
      s.comment.fnComment = s.comment.pending;
    },
    FC(p) {
      // ^FC<a>,<b>,<c>: redefine clock chars. Missing/empty slots
      // keep their current value (Zebra spec: defaults persist when
      // a parameter is omitted). `^` and `~` stay reserved.
      const accept = (raw: string | undefined, current: string) => {
        const c = raw?.[0];
        return c && c !== "^" && c !== "~" ? c : current;
      };
      s.format.clockChars = {
        date: accept(p[0], s.format.clockChars.date),
        time: accept(p[1], s.format.clockChars.time),
        tertiary: accept(p[2], s.format.clockChars.tertiary),
      };
      // Arming counts only before the ^FD (spec: ^FC/^FE precede the ^FD they
      // apply to); a late command must not re-decode captured field data.
      if (s.field.pendingFD === null) s.field.fcArmed = true;
    },
    FE(p) {
      // ^FE<char>: redefine the FN-embed delimiter used inside ^FD/^FV.
      // Single ASCII character, falls back to '#' when missing/invalid.
      const c = p[0]?.[0];
      s.format.embedChar = c && c !== "^" && c !== "~" ? c : "#";
      if (s.field.pendingFD === null) s.field.feArmed = true;
    },
    SO(p) {
      // ^SOa,b,c,d,e,f,g where a=clock# (2 or 3), then wire order
      // months,days,years,hours,minutes,seconds. Each slot signed,
      // empty=0. Writes to labelConfig.{secondary|tertiary}ClockOffset
      // so the resolver can compute per-channel Dates.
      const clockNum = (p[0] ?? "").trim();
      if (clockNum !== "2" && clockNum !== "3") return;
      const slot = (idx: number) => {
        const raw = (p[idx] ?? "").trim();
        if (raw === "") return 0;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : 0;
      };
      // Skip zero slots so the stored offset matches the schema's
      // non-empty invariant and stays uncluttered for the UI.
      const offset: Record<string, number> = {};
      const setIf = (key: string, idx: number) => {
        const n = slot(idx);
        if (n !== 0) offset[key] = n;
      };
      setIf("months", 1);
      setIf("days", 2);
      setIf("years", 3);
      setIf("hours", 4);
      setIf("minutes", 5);
      setIf("seconds", 6);
      if (Object.keys(offset).length === 0) {
        if (clockNum === "2") delete labelConfig.secondaryClockOffset;
        else delete labelConfig.tertiaryClockOffset;
      } else if (clockNum === "2") {
        labelConfig.secondaryClockOffset = offset;
      } else {
        labelConfig.tertiaryClockOffset = offset;
      }
    },

    // ^CC<char> / ~CC<char>: change the command prefix char (default ^).
    // The tokenizer reads s.format.caretChar live, so the next command in
    // the stream uses the new prefix. Reject chars that would collapse
    // a role boundary (tilde, delimiter) and end up parsing nothing.
    CC(_, rest) {
      const c = rest[0];
      if (!acceptsPrefixRemap(c, s.format.tildeChar, s.format.delimiterChar)) {
        s.result.partialCmds.add("^CC");
        return;
      }
      s.format.caretChar = c;
    },
    // ^CT<char> / ~CT<char>: change the tilde-form prefix (default ~).
    CT(_, rest) {
      const c = rest[0];
      if (!acceptsPrefixRemap(c, s.format.caretChar, s.format.delimiterChar)) {
        s.result.partialCmds.add("^CT");
        return;
      }
      s.format.tildeChar = c;
    },
    // ^CD<char> / ~CD<char>: change the parameter delimiter (default ,).
    CD(_, rest) {
      const c = rest[0];
      if (!acceptsPrefixRemap(c, s.format.caretChar, s.format.tildeChar)) {
        s.result.partialCmds.add("^CD");
        return;
      }
      s.format.delimiterChar = c;
    },
  };
}
