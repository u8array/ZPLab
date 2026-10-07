import { mmToDots } from "./coordinates";
import { stripZplParamChars } from "./zplParams";
import { effectiveDpmm, type JmDensity } from "../types/LabelConfig";

export const FONT_SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog 0123456789";

export interface SampleMedia {
  widthMm: number;
  heightMm: number;
  dpmm: number;
  jmDensity?: JmDensity;
}

/** A label that sets one printer font, sized to the media so the firmware renders it like a job. */
export function fontSampleZpl(fontPath: string, media: SampleMedia): string {
  // ^PW and ^LL stay in head dots, the field lives in the ^JM-scaled space like every generated object.
  const headWidth = mmToDots(media.widthMm, media.dpmm);
  const headHeight = mmToDots(media.heightMm, media.dpmm);
  const dpmm = effectiveDpmm(media);
  const width = mmToDots(media.widthMm, dpmm);
  // The shorter edge bounds margin and size, so a short or narrow label still holds the field.
  const edge = Math.min(width, mmToDots(media.heightMm, dpmm));
  const size = Math.max(1, Math.min(mmToDots(7.5, dpmm), Math.floor(edge / 4)));
  const margin = Math.min(mmToDots(5, dpmm), Math.floor(edge / 10));
  // Every line past the ^FB budget overprints the last one, so the budget is the text length.
  const block = `^FB${Math.max(width - 2 * margin, size)},${FONT_SAMPLE_TEXT.length},0,L`;
  const density = media.jmDensity === "B" ? "^JMB" : "";
  return `^XA${density}^PW${headWidth}^LL${headHeight}^FO${margin},${margin}^A@N,${size},,${stripZplParamChars(fontPath)}${block}^FD${FONT_SAMPLE_TEXT}^FS^XZ`;
}
