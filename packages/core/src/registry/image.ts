import type { ObjectTypeCore } from '../types/ObjectType';
import { graphicFieldPos } from './zplHelpers';
import { getImage } from '../lib/imageCache';
import { gfaFromRaster, rasterizeMono, scaledHeightDots } from '../lib/imageToZpl';
import { formatStoragePath } from '../lib/storagePath';
import { isAxisSwapped, objectRotation, type ZplRotation } from './rotation';

/** ^GF rows are byte-packed, so the emitted (and re-parsed) width is the next
 *  multiple of 8. Shared by the emitter and the home-shift drop check so a
 *  right-justified ^FT image keys its anchor off the same width. */
export function gfByteWidth(widthDots: number): number {
  return Math.ceil(widthDots / 8) * 8;
}

/** Emitted image height in dots. A cached image scales widthDots by the natural
 *  aspect (resize keeps only widthDots in sync, so heightDots can be stale);
 *  placeholders/opaque graphics fall back to the stored heightDots. Shared by
 *  the emitter and the home-shift drop check so the ^FT bottom anchor agrees. */
export function imageEmitHeight(p: ImageProps): number {
  const cached = getImage(p.imageId);
  // scaledHeightDots is the shared aspect+clamp SSOT (so the anchor can't
  // diverge from the emitted GRF); width>0 guards a malformed 0-width decode,
  // matching the render path.
  return cached && cached.width > 0
    ? scaledHeightDots(p.widthDots, cached.width, cached.height)
    : p.heightDots ?? p.widthDots;
}

/** An image rotates only when it's an inline cached bitmap: ^XG recall and
 *  opaque rawGf can't be re-encoded. The single predicate for "this instance
 *  turns", so the rotate button, emit footprint, and canvas can't disagree. */
export function isImageRotatable(p: ImageProps): boolean {
  return !!getImage(p.imageId) && !p.storedAs && !p.rawGf;
}

/** The rotation the bytes are resolved at. ^XG recall and opaque rawGf print
 *  upright by construction, so a rotation left over from an inline past is
 *  meaningless there, not merely unachievable: gating on it dropped the ~DY
 *  while the ^XG depending on it still shipped. A cache with no source image
 *  keeps its rotation, so an impossible re-raster still refuses out loud
 *  instead of printing the wrong orientation. */
export function imageEmitRotation(p: ImageProps): ZplRotation {
  return p.storedAs || p.rawGf ? 'N' : objectRotation(p);
}

/** Emitted (byte-padded) footprint of the image field, axes swapped on a baked
 *  R/B rotation. Shared by toZPL and the generator's home-shift drop check so
 *  the two can't disagree on the anchor footprint. */
export function imageEmitDims(p: ImageProps): { width: number; height: number } {
  if (isImageRotatable(p) && isAxisSwapped(objectRotation(p))) {
    return { width: gfByteWidth(imageEmitHeight(p)), height: p.widthDots };
  }
  const header = gfaHeaderDims(headerByteSource(p));
  if (header) {
    return { width: header.width, height: header.height ?? (p.heightDots ?? p.widthDots) };
  }
  return { width: gfByteWidth(p.widthDots), height: imageEmitHeight(p) };
}

export interface ImageProps {
  /** ID into the image cache */
  imageId: string;
  /** 90-degree orientation. `^GF` has no orientation letter, so a non-N
   *  rotation is baked into the emitted bitmap (see toZPL); the canvas shows it
   *  via rotatedGroupTransform. Only cached (editable) images honour it.
   *  Optional: designs saved before image rotation existed omit it (read as
   *  'N' via objectRotation). New images seed it from defaultProps. */
  rotation?: ZplRotation;
  /** Target width in dots (height derived from aspect ratio when a cached
   *  PNG is available; falls back to `heightDots` for recall-only
   *  placeholders). */
  widthDots: number;
  /** Override height for placeholder/recall-only images that have no
   *  cached bytes; without it the box would snap to a fixed default
   *  and ignore the user's drag. Only consulted when `imageId` does
   *  not resolve to a cached image. */
  heightDots?: number;
  /** Luminance threshold for mono conversion (0-255) */
  threshold: number;
  /** Cached GFA ZPL string; regenerated when image/width/threshold changes */
  _gfaCache?: string;
  /** Verbatim `^GF` for graphics we can't decode into an editable bitmap
   *  (binary B, compressed C, `:Z64:`, ACS run-length); re-emitted as-is to
   *  round-trip. Mutually exclusive with a cached `imageId`. */
  rawGf?: string;
  /** When set, the image is uploaded once via `~DY` (preamble) and referenced
   *  per-instance via `^XG`. Set by the parser when a ZPL stream uses the
   *  upload+recall pattern, preserved on re-export. Without this the image
   *  emits inline `^GF` as before. */
  storedAs?: {
    /** Storage device prefix without trailing colon: "R", "E", "B", or "A". */
    device: string;
    /** Filename stem (no extension); paired with `.GRF` for graphics. */
    name: string;
    /** Ship the bitmap bytes via `~DY` alongside the `^XG` reference.
     *  Default true on first toggle so a single-job ZPL is self-contained.
     *  False = recall-only: assume the file is already on printer storage,
     *  emit only `^XG`. Mirrors the customFonts `embedInZpl` pattern. */
    embedInZpl?: boolean;
  };
}

/** Synchronously generate ^GFA using a blocking canvas (for toZPL), rotation
 *  baked in. Shares the encoder (rasterizeMono) with the async panel path. */
function gfaSync(dataUrl: string, widthDots: number, threshold: number, rotation: ZplRotation): string {
  // Headless (Node/MCP): no Image decode; emits the anchor without bytes.
  if (typeof Image === "undefined") return '';
  const img = new Image();
  // data-URL loads are synchronous on a freshly-created Image.
  img.src = dataUrl;
  if (!img.complete || !img.naturalWidth) return '';
  const raster = rasterizeMono(img, widthDots, threshold, rotation);
  return raster ? gfaFromRaster(raster) : '';
}


export interface GfHeader {
  format: "A" | "B" | "C";
  /** b / c params as written; byte-count headers are optional (empty string). */
  totalBytes: string;
  dataBytes: string;
  bytesPerRow: number;
  payload: string;
}

/** The one ^GF header grammar. Every consumer (dims, preview decode, ~DY
 *  upload, the MCP boundary) reads it through here, so they cannot drift on
 *  what counts as a header. */
export function parseGfHeader(value: string | undefined): GfHeader | null {
  // The comma after d is required whenever a payload follows: without it the
  // firmware reads "2FF00" as d and drops the graphic.
  const m = value ? /^\^GF([ABC]),(\d*),(\d*),(\d+)(?:,|$)/.exec(value) : null;
  if (!m) return null;
  // b and c stay ungated: the spec's 1..99999 (p.215) is a doc limit, not a
  // wire limit, and our own encoder emits past it.
  const bytesPerRow = Number(m[4]);
  if (bytesPerRow <= 0) return null;
  return {
    format: m[1] as GfHeader["format"],
    totalBytes: m[2] ?? "",
    dataBytes: m[3] ?? "",
    bytesPerRow,
    payload: value !== undefined ? value.slice(m[0].length) : "",
  };
}

/** 8192 dots a row, far past any real label at 24 dpmm. Shared cap so bounds,
 *  emit and the preview decoder reject the same runaway header. */
export const GF_MAX_BYTES_PER_ROW = 1024;

/** Rows a header may declare. Past this it is not a label graphic, and the
 *  derived height would reach the emitted ^FT and the off-label check. */
export const GF_MAX_ROWS = 20_000;

/** Whether this ^GF can ship verbatim: format A and the base64 wrappers ban ^/~ anywhere, raw binary only past its declared count. */
export function gfShipsSafely(value: string): boolean {
  const head = parseGfHeader(value);
  // The shared runaway cap, applied here too: without it a wide graphic shipped
  // at full width while gfaHeaderDims returned null and the footprint fell back
  // to the props width, so emit and bounds described different ink.
  if (head && head.bytesPerRow > GF_MAX_BYTES_PER_ROW) return false;
  // A header we cannot read carries no count to bound its data by, so nothing
  // here can tell data from an appended command.
  if (!head) return false;
  // A bare header declares bytes it never sends, so the firmware reads the rest
  // of the stream as graphic data (p.215) and the block never terminates.
  if (head.payload.trim() === "") return false;
  // Same outcome without c: Labelary produces no label for a header missing it,
  // because nothing tells the firmware where the graphic ends. b may be omitted
  // freely, which renders identically.
  if (head.dataBytes === "") return false;
  const trimmed = head.payload.replace(/^\s+/, "");
  const wrapped = trimmed.startsWith(":B64:") || trimmed.startsWith(":Z64:");
  // p.215, ASCII hex: "~DN or any caret or tilde character prematurely aborts
  // the download"; format A and the base64 wrappers ban either character anywhere.
  if (head.format === "A" || wrapped) return !/[\^~]/.test(head.payload);
  // Boundary is c (bitmap size), not b (host bytes), per spec p.215; without c nothing bounds the data.
  const countStr = head.format === "C" ? "" : head.dataBytes;
  if (countStr === "") return !/[\^~]/.test(head.payload);
  const byteCount = Number(countStr);
  if (!Number.isInteger(byteCount) || byteCount < 0) return false;
  // Wire bytes, not string indices: the generator emits ^CI28, so one payload char can be several bytes.
  const wire = new TextEncoder().encode(head.payload);
  return !wire.subarray(byteCount).some((b) => b === 0x5e || b === 0x7e);
}

/** Printed size from a ^GF header (spec p.215: width = bytes per row x 8,
 *  lines = count / bytes per row); the header, not the props, is the byte truth
 *  for store-less emit and bounds. Empty count slot: height null, callers fall
 *  back to model dims; null on fractional rows or a runaway width. */
export function gfaHeaderDims(
  cache: string | undefined,
): { width: number; height: number | null } | null {
  const h = parseGfHeader(cache);
  // A payload-less header (^GFA,8,8,1 with no data) is not a usable graphic:
  // emit would ship the bare header and firmware would read past it into ^FS.
  if (!h || h.bytesPerRow > GF_MAX_BYTES_PER_ROW || h.payload.trim() === "") return null;
  // c is required: Labelary renders a header missing b identically to a full
  // one, but a header missing c produces no label at all, because the firmware
  // never learns where the graphic ends and eats the rest of the stream.
  if (h.dataBytes === "") return null;
  const width = h.bytesPerRow * 8;
  const height = Number(h.dataBytes) / h.bytesPerRow;
  // Rows bounded like the width: an unbounded c drove a 20-million-dot field
  // into the ^FT anchor and the off-label check, and past 1e21 the number
  // formats as "1e+21", which no firmware parses.
  if (!Number.isInteger(height) || height <= 0 || height > GF_MAX_ROWS) return null;
  return { width, height };
}

/** Store-less byte source: unrotated (a re-raster needs the source image) with a
 *  parsable header that also provides the emit dimensions, and bytes the stream
 *  can carry as data rather than as commands. */
function gfaCacheUsable(p: ImageProps): boolean {
  return (
    !!p._gfaCache &&
    imageEmitRotation(p) === 'N' &&
    gfaHeaderDims(p._gfaCache) !== null &&
    gfShipsSafely(p._gfaCache)
  );
}

/** Bytes with no source image are the graphic's only copy: no edit may clear or re-encode them, at any rotation. */
export function gfaCacheIsOnlyCopy(p: ImageProps): boolean {
  return !!p._gfaCache && !getImage(p.imageId);
}

/** The graphic whose header describes the printed ink, for the sites that size
 *  the field. rawGf counts at any rotation because toZPL ships it verbatim; a
 *  cache only upright, where the emit uses it too. */
export function headerByteSource(p: ImageProps): string | undefined {
  if (getImage(p.imageId)) return undefined;
  // Only bytes emit will actually ship; memoised per props object because this is scanned several times per frame.
  const hit = SHIP_SOURCE_CACHE.get(p);
  if (hit !== undefined) return hit.value;
  const source = p.rawGf
    ? gfShipsSafely(p.rawGf)
      ? p.rawGf
      : undefined
    : imageEmitRotation(p) === 'N' && p._gfaCache && gfShipsSafely(p._gfaCache)
      ? p._gfaCache
      : undefined;
  SHIP_SOURCE_CACHE.set(p, { value: source });
  return source;
}

/** Boxed so a cached `undefined` is still a hit. */
const SHIP_SOURCE_CACHE = new WeakMap<ImageProps, { value: string | undefined }>();

/** Fresh upright ^GFA from the image store, for emit sites that need bytes
 *  after a cache-clearing edit (canvas resize regens only via the panel). */
export function inlineGfaFor(p: ImageProps, rotation: ZplRotation = 'N'): string | undefined {
  const img = getImage(p.imageId);
  if (!img) return undefined;
  return gfaSync(img.dataUrl, p.widthDots, p.threshold, rotation) || undefined;
}

/** The ^GF bytes to ship, cache or fresh encode; undefined means nothing prints. Both stream sites read this. */
export function shippableGfa(p: ImageProps, rotation: ZplRotation = 'N'): string | undefined {
  if (rotation === 'N' && p._gfaCache && gfShipsSafely(p._gfaCache)) return p._gfaCache;
  return inlineGfaFor(p, rotation);
}

export const image: ObjectTypeCore<ImageProps> = {
  label: 'Image',
  icon: 'img',
  zplCmd: '^GF',
  group: 'shape',
  defaultProps: {
    imageId: '',
    widthDots: 200,
    threshold: 128,
    rotation: 'N',
  },
  defaultSize: { width: 200, height: 200 },

  // A width/threshold change without a fresh cache in the same change
  // invalidates the bytes, or emit/preflight would use the stale raster.
  normalizeChanges: (obj, changes) => {
    const next = changes.props as Partial<ImageProps> | undefined;
    if (!next || !('widthDots' in next || 'threshold' in next) || '_gfaCache' in next) {
      return changes;
    }
    // Only when a source image can re-encode them: otherwise the cache is the
    // graphic's only copy and clearing it prints nothing.
    if (gfaCacheIsOnlyCopy(obj.props)) return changes;
    return { ...changes, props: { ...next, _gfaCache: undefined } };
  },

  // No resolvable bytes (no opaque ^GF, no recall path, nothing cached) emits a
  // blank ^FD^FS, so flag the silent empty graphic. Pure (mirrors toZPL), so it
  // also covers exportable-but-hidden images the canvas never renders.
  preflight: (obj) => {
    const p = obj.props;
    // Named separately from "no bytes at all": these bytes exist but carry a ^/~
    // the firmware would read as a command, so emit drops them (see toZPL) and
    // the user/agent has to hear why rather than seeing a blank field.
    if (p.rawGf && !gfShipsSafely(p.rawGf)) {
      return [{ kind: 'imageMissing', detail: 'the stored ^GF bytes carry ^ or ~ outside their declared byte count, so they cannot be printed' }];
    }
    // A recall field whose ~DY got dropped still keeps its ^XG, so storedAs alone cannot mark it resolvable.
    if (p.storedAs && p.storedAs.embedInZpl !== false) {
      // Asked, not rasterised: this runs on every findings recompute, so it must not force a full re-encode.
      const canUpload = p._gfaCache ? gfShipsSafely(p._gfaCache) : !!getImage(p.imageId);
      if (!canUpload) {
        return [{ kind: 'imageMissing', detail: 'this field recalls a stored graphic whose upload cannot be written, so the printer has nothing to recall' }];
      }
    }
    const resolvable =
      !!p.rawGf || !!p.storedAs || !!getImage(p.imageId) || gfaCacheUsable(p);
    return resolvable ? [] : [{ kind: 'imageMissing' }];
  },

  // Resize via canvas-handle:
  //  - With cached PNG → aspect locked, height re-derives from widthDots.
  //    Pick the dominant scale (largest deviation from 1) so all eight
  //    handles work for both grow and shrink. Math.max would mis-handle
  //    inward single-axis drags (sx=0.5, sy=1 → max=1 → no change).
  //  - Without cache (recall-only placeholder) → free-form. widthDots
  //    and heightDots scale independently so the user can shape the
  //    placeholder box for layout purposes.
  // _gfaCache always cleared; for cached images the hex needs regen at
  // the new width; for placeholders it's empty anyway.
  commitTransform: (obj, ctx) => {
    // Opaque verbatim graphics carry fixed bytes we can't re-encode, so the
    // box size is locked; ignore the resize.
    if (obj.props.rawGf) return {};
    const { sx, sy, snap } = ctx;
    const cached = getImage(obj.props.imageId);
    const widthDots = (scale: number): number =>
      Math.max(8, snap(Math.round(obj.props.widthDots * scale)));
    if (cached) {
      const dominant = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      return { widthDots: widthDots(dominant), _gfaCache: undefined };
    }
    // Bytes with no source image cannot be re-encoded at a new size, so the box is kept rather than cleared.
    if (gfaCacheIsOnlyCopy(obj.props)) return {};
    // First-resize fallback for heightDots: use the current widthDots so
    // the implicit default (square placeholder) matches what the canvas
    // renders before the user has dragged. Drifting from that (e.g. a
    // hard-coded 200) would mean the first drag visibly snaps the box.
    const baseHeight = obj.props.heightDots ?? obj.props.widthDots;
    return {
      widthDots: widthDots(sx),
      heightDots: Math.max(8, snap(Math.round(baseHeight * sy))),
      _gfaCache: undefined,
    };
  },

  toZPL: (obj) => {
    const p = obj.props;
    const cached = getImage(p.imageId);
    // ^FT anchors the graphic's bottom-left (spec p.205); right-justified ^FT
    // keys its x off the byte-padded ^GF width. imageEmitDims applies the R/B
    // axis swap (cached only), and the same helper feeds the home-shift drop
    // check so the two agree. ^FO ignores the footprint.
    const d = imageEmitDims(p);
    const anchor = graphicFieldPos(obj, d.width, d.height);
    // Opaque graphic: re-emit the original ^GF verbatim at the (possibly moved)
    // field position. The bytes were never decoded, so there's nothing to regen.
    // Guarded here rather than at the input boundary: this is the one place that
    // turns them into a stream, and it needs no guess about where they came from
    // (preflight reports the same refusal, so the drop is never silent).
    if (p.rawGf) {
      return gfShipsSafely(p.rawGf) ? `${anchor}${p.rawGf}^FS` : `${anchor}^FD^FS`;
    }
    // Recall path: upload happened in the preamble; here we just reference
    // it via ^XG. The `.GRF` extension is implicit on `~DY{path},A,G,…`;
    // Zebra firmware persists the file as `path.GRF` and `^XG` resolves
    // the dot-suffixed form.
    if (p.storedAs) {
      return `${anchor}^XG${formatStoragePath(p.storedAs, true)},1,1^FS`;
    }
    if (!cached) {
      // Headless host (MCP sidecar) has no image store; the imported ^GFA
      // cache is the only byte source. Rotation would need a re-raster.
      if (gfaCacheUsable(p)) return `${anchor}${p._gfaCache}^FS`;
      return `${anchor}^FD^FS`;
    }
    // _gfaCache holds the upright bytes, so a rotated field regenerates fresh
    // (rasterizeMono bakes the rotation in).
    return `${anchor}${shippableGfa(p, imageEmitRotation(p)) ?? ''}^FS`;
  },
};
