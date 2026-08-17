/** Text layout mode. 'normal' = plain ^A (no wrap), 'fb' = ^FB field
 *  block (max-lines cap, justify, hanging indent), 'tb' = ^TB text block
 *  (word-wrap clipped at a pixel height). Only 'tb' is stored explicitly;
 *  'normal' vs 'fb' is inferred from blockWidth presence so legacy designs
 *  and ^FB imports keep working. Read it through `resolveTextMode`.
 *
 *  Own leaf module (not text.ts) so emit helpers can consult the mode
 *  without a registry cycle. */
export type TextMode = "normal" | "fb" | "tb";

export function resolveTextMode(p: {
  textMode?: TextMode;
  blockWidth?: number;
  serial?: object;
}): TextMode {
  // Serial is a plain single-line counter (^A + ^SN/^SF); block props lie
  // dormant while it is active, so the mode resolves to 'normal' regardless.
  if (p.serial) return "normal";
  if (p.textMode) return p.textMode;
  return p.blockWidth ? "fb" : "normal";
}
