import { generateZPL } from "@zplab/core/lib/zplGenerator";
import { stripSidecarComments } from "@zplab/core/lib/zplLabelMeta";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import { isGroup, withoutStoredFormat, type LabelObject } from "@zplab/core/types/Group";
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

/** The ZPL Labelary and the printer render: row-substituted and flat without ^FN, so the render matches
 *  the print. Only the preview overlay opts into blank-field samples, a print never puts sample data on
 *  paper. `label` carries the page's ^JM override, because the emitted dots live in that density. */
export function buildPreviewZpl(
  label: PageLabel,
  objects: LabelObject[],
  variables: readonly Variable[],
  active: ActiveRow | null,
  opts: { blankSamples?: boolean } = {},
): string {
  const substituted = applyBindingToTree(objects, variables, active, "preview", clockCtxFromLabel(label), ctrlParityFor);
  const previewed = opts.blankSamples ? withBlankSamples(substituted) : substituted;
  // A preview is never re-imported, so nothing but printer bytes goes to the renderer,
  // and a render must print, so the format is not stored (^DF prints nothing, p.1704).
  return stripSidecarComments(generateZPL(withoutStoredFormat(label), previewed, []));
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

export async function printLabel(image: Promise<string>): Promise<void> {
  // Open the window synchronously (inside the user-click call stack) so browsers
  // don't treat it as a popup. Fill it in once the render arrives.
  const win = window.open("", "_blank");
  if (!win) {
    // The render is already under way. Settle it, so nothing rejects unhandled and no blob URL leaks.
    void image.then((url) => URL.revokeObjectURL(url), () => undefined);
    return;
  }
  win.document.write(buildLoadingHtml());
  win.document.close();

  try {
    const url = await image;
    win.document.open();
    win.document.write(buildPrintHtml(url));
    win.document.close();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    win.close();
    throw e;
  }
}
