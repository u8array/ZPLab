import type { ZplTokenType } from "./zplTokenize";

/** Tailwind colour per ZPL token type (see index.css theme tokens). */
export const TOKEN_CLASS: Record<ZplTokenType, string> = {
  structural: "text-accent font-semibold",
  command: "text-accent font-medium",
  fieldData: "text-string",
  comment: "text-muted italic",
  number: "text-info",
  enum: "text-text",
  separator: "text-muted",
  text: "text-muted",
};

// A ~DY/~DG payload can be megabytes on one line; tokenizing it yields millions
// of tokens and freezes either view, so both tokenize only this much.
export const MAX_LINE_RENDER = 2000;
