import type { ObjectTypeCore } from '../types/ObjectType';
import type { LabelObjectBase } from '../types/LabelObject';
import { fieldPosZ, fdFieldFor } from './zplHelpers';
import { moduleTooSmallPreflight } from '../lib/barcodeScannability';
import { hasTemplateMarkers } from '../lib/fnTemplate';
import { formatQrSidecarComment, qrRotatedGfaCached } from '../lib/qrGraphic';
import { clockCtxFromLabel, resolveContentPreview } from '../lib/markerResolve';
import { type ZplRotation } from './rotation';
import { qrByHeight } from '../lib/qrBy';

/** ZPL prefixes the QR payload with `{ec}A,` inside ^FD. Shared by toZPL and
 *  the CSV batch override so a per-row value also gets the prefix. */
const qrFdTransform =
  (obj: LabelObjectBase & { props: QrCodeProps }) =>
  (s: string): string =>
    `${obj.props.errorCorrection}A,${s}`;

export const MAGNIFICATION_MIN = 1;
export const MAGNIFICATION_MAX = 10;
// Re-exported from lib/qrBy (the cycle-free spot) because this is the prop's home.
export { QR_BY_DEFAULT_HEIGHT, isQrByHeight, qrByHeight } from '../lib/qrBy';

export interface QrCodeProps {
  content: string;
  magnification: number;       // dot size per module
  errorCorrection: 'H' | 'Q' | 'M' | 'L';
  /** ^BQ b: 1 = original, 2 = enhanced (recommended, default). */
  model: 1 | 2;
  /** ^BQ can't rotate (firmware no-op), so a non-N rotation emits a pre-rotated
   *  ^GFA graphic + sidecar. */
  rotation: ZplRotation;
  /** ^BY height in effect at the source field. The firmware sinks an ^FO QR by
   *  the session's ^BY height (ZD230: h-1, Labelary: h), so an unpinned field
   *  prints wherever the printer's last ^BY put it; absent = power-up default. */
  byHeight?: number;
}

// One switch for the capability flag and the emitter's chip resolution.
const CONTROL_CHARS = true;

export const qrcode: ObjectTypeCore<QrCodeProps> = {
  label: 'QR Code',
  icon: '⬚',
  zplCmd: '^BQ',
  group: 'code-2d',
  bindable: true,
  controlChars: CONTROL_CHARS,
  typedContent: true,
  defaultProps: {
    content: '',
    magnification: 4,
    errorCorrection: 'Q',
    model: 2,
    rotation: 'N',
  },
  placeholderContent: 'https://example.com',
  defaultSize: { width: 200, height: 200 },

  uniformScaleProp: { name: 'magnification', min: MAGNIFICATION_MIN, max: MAGNIFICATION_MAX },

  preflight: (obj, ctx) => [
    ...moduleTooSmallPreflight<QrCodeProps>('magnification')(obj, ctx),
    // A ^GFA has no ^FN, so a rotated QR freezes dynamic content (markers or
    // serial) at its export-time value.
    ...(obj.props.rotation !== 'N' &&
    (hasTemplateMarkers(obj.props.content) || 'serial' in obj.props)
      ? [{ kind: 'qrRotatedStatic' as const }]
      : []),
    // The graphic encoder only produces Model 2 symbols.
    ...(obj.props.rotation !== 'N' && obj.props.model === 1
      ? [{ kind: 'qrRotatedModel2' as const }]
      : []),
  ],

  fdTransform: qrFdTransform,

  toZPL: (obj, ctx) => {
    const p = obj.props;
    // ^BQ can't rotate: emit the exact matrix as a pre-rotated ^GFA. It bakes the
    // preview value (no ^FN, so static, hence qrRotatedStatic); the sidecar keeps
    // the raw content for reimport; fieldPos keeps the barcode anchor. Empty or
    // unencodable content falls through to plain ^BQ (payload stays empty there).
    if (p.rotation !== 'N') {
      const resolved = resolveContentPreview(
        p.content,
        ctx?.variables ?? [],
        ctx ? clockCtxFromLabel(ctx.label) : undefined,
      );
      const g = resolved ? qrRotatedGfaCached(p, { ...p, content: resolved }) : null;
      if (g) {
        return [formatQrSidecarComment(p), fieldPosZ(obj), g.gfa, '^FS'].join('');
      }
    }
    // Prefix passed as the fdFieldFor transform (not baked into content) so it
    // composes with the binding: single-bind default / template / CSV override
    // all get the prefix instead of the payload being emitted raw.
    // ^BY pins the height the ^FO sink depends on (w/r left empty: 1D fields
    // carry their own ^BY). In-span, i.e. AFTER ^FO, so the overlay's bare-^BY
    // check sees it and a regen replays it byte-exactly. ^FT anchors are immune.
    return [
      fieldPosZ(obj),
      obj.positionType !== 'FT' ? `^BY,,${qrByHeight(p)}` : '',
      `^BQN,${p.model},${p.magnification}`,
      fdFieldFor(p.content, ctx, qrFdTransform(obj), undefined, CONTROL_CHARS),
    ].join('');
  },
};
