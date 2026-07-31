import type { ReactNode } from "react";
import type { TextProps } from "@zplab/core/registry/text";

export type Justify = NonNullable<TextProps["blockJustify"]>;

/** Inline SVG glyphs for the four justify modes, shared by JustifyButtons and
 *  the 1D-barcode value-anchor control. currentColor stroke drives theming;
 *  inline SVG avoids font-fallback tofu for the niche arrow glyphs. */
export const JUSTIFY_ICONS: Record<Justify, ReactNode> = {
  L: (
    <svg viewBox="0 0 16 12" className="w-4 h-3 mx-auto" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="2" x2="15" y2="2" />
      <line x1="1" y1="6" x2="11" y2="6" />
      <line x1="1" y1="10" x2="13" y2="10" />
    </svg>
  ),
  C: (
    <svg viewBox="0 0 16 12" className="w-4 h-3 mx-auto" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="2" x2="15" y2="2" />
      <line x1="3" y1="6" x2="13" y2="6" />
      <line x1="2" y1="10" x2="14" y2="10" />
    </svg>
  ),
  R: (
    <svg viewBox="0 0 16 12" className="w-4 h-3 mx-auto" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="2" x2="15" y2="2" />
      <line x1="5" y1="6" x2="15" y2="6" />
      <line x1="3" y1="10" x2="15" y2="10" />
    </svg>
  ),
  J: (
    <svg viewBox="0 0 16 12" className="w-4 h-3 mx-auto" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="2" x2="15" y2="2" />
      <line x1="1" y1="6" x2="15" y2="6" />
      <line x1="1" y1="10" x2="15" y2="10" />
    </svg>
  ),
};
