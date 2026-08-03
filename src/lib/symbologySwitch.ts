import { getEntry, isGs1Active, ObjectRegistry } from "@zplab/core/registry";
import { resolveContentSpec, hasValidLength, violatesCharset } from "@zplab/core/registry/contentSpec";
import type { ContentSpec } from "@zplab/core/types/contentSpec";
import type { LeafType } from "@zplab/core/registry/leafObject";
import type { ObjectGroup } from "@zplab/core/types/LabelObject";
import type { LabelObject } from "@zplab/core/types/Group";
import { mapLiteralSpans } from "@zplab/core/lib/fnTemplate";
import { hasControlMarkers, resolveControlMarkers } from "@zplab/core/types/controlKey";

const BARCODE_GROUPS: ReadonlySet<ObjectGroup> = new Set(["code-1d", "code-2d", "legacy"]);

type CoreEntry = NonNullable<ReturnType<typeof getEntry>>;

/** Props patch that puts a target into GS1 mode when GS1 content is carried in. */
const gs1EnterProps = (entry: CoreEntry): object => entry.gs1EnterProps ?? { gs1: true };

/** Why a target symbology is disabled for the current content. Keys map to the
 *  few generic localized reason texts, not per-symbology prose. */
export type SymbologyFitReason = "digitsOnly" | "charset" | "length";

export interface SymbologyTarget {
  type: LeafType;
  group: ObjectGroup;
  disabled: boolean;
  reason?: SymbologyFitReason;
}

/** Static fit check: charset on literal slices only («marker» chips resolve at
 *  print time), length rules only on fully literal content. Deliberately not
 *  the full encoder truth; bwip stays the runtime authority and the canvas
 *  error frame catches what a static rule cannot know. */
function contentFitReason(content: string, spec: ContentSpec | undefined): SymbologyFitReason | null {
  if (!spec || content === "") return null;
  // Control chips have a known byte, so judge them AS that byte: a TAB chip
  // must disable EAN/Code 39 exactly like a typed control char would.
  if (hasControlMarkers(content)) content = resolveControlMarkers(content);
  let badCharset = false;
  mapLiteralSpans(content, (slice) => {
    if (violatesCharset(slice, spec)) badCharset = true;
    return slice;
  });
  // Coarse hint only: "0-9" is the registry's sole digits-only spelling.
  if (badCharset) return spec.charset === "0-9" ? "digitsOnly" : "charset";
  if (content.includes("«")) return null;
  if (spec.maxLength !== undefined && content.length > spec.maxLength) return "length";
  if (!hasValidLength(content, spec)) return "length";
  return null;
}

/** Every barcode-group symbology as a switch target, with per-target fit
 *  (disabled + reason) for the current content. The shared source both switch
 *  UIs render; empty for non-barcode objects. */
export function symbologyTargets(obj: LabelObject): SymbologyTarget[] {
  const source = getEntry(obj.type);
  if (!source || !BARCODE_GROUPS.has(source.group)) return [];
  const props = (obj as { props?: Record<string, unknown> }).props;
  const content = (props?.content as string | undefined) ?? "";
  const srcGs1 = isGs1Active(source, props);
  return (Object.keys(ObjectRegistry) as LeafType[])
    .filter((t) => BARCODE_GROUPS.has(ObjectRegistry[t].group))
    .map((t) => {
      const target = ObjectRegistry[t];
      // Judge fit against the mode the convert would land in: the mapper
      // puts a capable target into GS1 mode, everything else gets defaults.
      const fitProps =
        srcGs1 && target.gs1Capable
          ? { ...target.defaultProps, ...gs1EnterProps(target) }
          : target.defaultProps;
      const reason =
        t === obj.type
          ? null
          : contentFitReason(content, resolveContentSpec(target.contentSpec, fitProps));
      return { type: t, group: target.group, disabled: reason !== null, ...(reason ? { reason } : {}) };
    });
}

/** Mapper for `convertObjectType`. Content and rotation carry (barcode rotation
 *  lives in `props.rotation`, not the top-level field); gs1/serial only onto a
 *  target that supports them; everything else is the target's defaults. No-op
 *  for non-barcode or same-type conversions. */
export function convertSymbologyMapper(targetType: LeafType): (obj: LabelObject) => LabelObject {
  return (obj) => {
    const source = getEntry(obj.type);
    const target = getEntry(targetType);
    if (!source || !target || obj.type === targetType || !("props" in obj)) return obj;
    if (!BARCODE_GROUPS.has(source.group) || !BARCODE_GROUPS.has(target.group)) return obj;
    const p = obj.props as unknown as Record<string, unknown>;
    const props: Record<string, unknown> = { ...target.defaultProps };
    if (typeof p.content === "string") props.content = p.content;
    if (p.rotation !== undefined && "rotation" in props) props.rotation = p.rotation;
    if (isGs1Active(source, p) && target.gs1Capable) Object.assign(props, gs1EnterProps(target));
    if (p.serial !== undefined && target.serialisable) {
      props.serial = { ...(p.serial as object) };
      // The serial-off restore snapshot travels with the serial flag.
      if (typeof p.preSerialContent === "string") props.preSerialContent = p.preSerialContent;
    }
    // x-space differs per class (see fieldPos/fieldPosZ), so the flag must
    // not survive a 1D <-> non-1D crossing.
    const crossed = (source.barcodeClass === '1d') !== (target.barcodeClass === '1d');
    return {
      ...obj,
      type: targetType,
      props,
      ...(crossed ? { fieldJustify: undefined } : {}),
    } as unknown as LabelObject;
  };
}
