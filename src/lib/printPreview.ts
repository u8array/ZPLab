import { generateZPL } from "@zplab/core/lib/zplGenerator";
import { fetchPreview } from "./labelary";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";
import { isGroup, type LabelObject } from "@zplab/core/types/Group";
import type { Variable } from "@zplab/core/types/Variable";
import { applyBindingToTree, clockCtxFromLabel, getObjectStringContent, type ActiveRow } from "@zplab/core/lib/variableBinding";
import { ctrlParityFor } from "@zplab/core/registry";
import { placeholderContentFor, samplePropsFor } from "@zplab/core/registry/placeholderContent";

/** Blank fields rendered with their symbology sample, so the preview overlay
 *  matches the canvas (which shows the same sample behind the warning frame).
 *  Overlay-only: print and export keep the empty ^FD. */
function withBlankSamples(objects: LabelObject[]): LabelObject[] {
  return objects.map((o): LabelObject => {
    if (isGroup(o)) return { ...o, children: withBlankSamples(o.children) };
    const content = getObjectStringContent(o);
    if (content === undefined || content.trim() !== "") return o;
    const sample = placeholderContentFor(o.type, o.props);
    if (!sample) return o;
    return { ...o, props: { ...samplePropsFor(o.type, o.props), content: sample } } as LabelObject;
  });
}

/** Generate the ZPL we hand to Labelary: row-substituted + flat
 *  (no ^FN), so the rendered preview matches what would print for
 *  the active CSV row (or the variable defaults when no row is
 *  loaded). Shared by `printLabel` (new window with image) and
 *  `enterPreviewMode` (canvas overlay) so the two stay in lockstep;
 *  only the overlay opts into blank-field samples, printing must
 *  never put sample data on paper. `label` is the page's label (its ^JM
 *  override included), since the emitted dots live in that density. */
export function buildPreviewZpl(
  label: LabelConfig,
  objects: LabelObject[],
  variables: readonly Variable[],
  active: ActiveRow | null,
  opts: { blankSamples?: boolean } = {},
): string {
  const substituted = applyBindingToTree(objects, variables, active, "preview", clockCtxFromLabel(label), ctrlParityFor);
  const previewed = opts.blankSamples ? withBlankSamples(substituted) : substituted;
  return generateZPL(label, previewed, []);
}

export function buildLoadingHtml(): string {
  return `<html><head><style>
    body { margin: 0; display: flex; justify-content: center; align-items: center;
           height: 100vh; font-family: monospace; color: #888; background: #111; }
  </style></head><body>Loading preview…</body></html>`;
}

export function buildPrintHtml(imageUrl: string): string {
  return `<html><head><style>
    body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; }
    img { max-width: 100%; max-height: 100%; }
    @media print { body { height: auto; } }
  </style></head>
  <body><img src="${imageUrl}" onload="window.print();window.close();" /></body>
  </html>`;
}

export async function printLabel(
  label: LabelConfig,
  objects: LabelObject[],
  host: string,
  apiKey: string | undefined,
  variables: readonly Variable[] = [],
  active: ActiveRow | null = null,
): Promise<void> {
  // Open the window synchronously (inside the user-click call stack) so browsers
  // don't treat it as a popup. Fill it in once the Labelary preview arrives.
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(buildLoadingHtml());
  win.document.close();

  try {
    const zpl = buildPreviewZpl(label, objects, variables, active);
    const url = await fetchPreview(zpl, label, host, apiKey);
    win.document.open();
    win.document.write(buildPrintHtml(url));
    win.document.close();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    win.close();
    throw e;
  }
}
