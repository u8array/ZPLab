/** The characters that end a positional parameter slot: command markers plus
 *  the comma, unlike a ^FX comment that runs to the next command. Shared by
 *  the emit strip and the boundary reject so the two cannot diverge. */
export const ZPL_PARAM_CHARS = /[\^~,]/;

export function stripZplParamChars(s: string): string {
  return s.replace(new RegExp(ZPL_PARAM_CHARS.source, "g"), "");
}
