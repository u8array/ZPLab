// Kept apart from index.ts so the zod schema stays out of the app bundle: only
// catalog.test.ts validates the checked-in JSON, the app imports the types.
import { z } from "zod";

const SUPPORT_LEVELS = ["yes", "planned", "no"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

/** What a partial import drops; the app maps each cause to its report wording. */
const IMPORT_LOSS_CAUSES = ["fontFace", "printerComms", "gfRawBinary", "qrFdMode", "fileStorage", "printerStorage", "fnPartialInsert"] as const;
export type ImportLossCause = (typeof IMPORT_LOSS_CAUSES)[number];

/** Support per axis; docs/zpl-coverage.md defines the three. */
const supportSchema = z.object({ web: z.enum(SUPPORT_LEVELS), desktop: z.enum(SUPPORT_LEVELS), lint: z.enum(SUPPORT_LEVELS) }).strict();
export type CommandSupport = z.infer<typeof supportSchema>;

const commandSchema = z.object({
  cmd: z.string().regex(/^[A-Z0-9@]{1,2}$/),
  prefixes: z.array(z.enum(["^", "~"])).min(1).max(2),
  /** Spellings the guide lists for the same command (^B0 and ^BO). */
  aliases: z.array(z.string()).optional(),
  section: z.string().min(1),
  /** The one-line name the coverage doc and the panel show; no sentences, no parentheses. */
  title: z.string().min(1),
  support: supportSchema,
  loss: z.enum(IMPORT_LOSS_CAUSES).optional(),
}).strict();

export const catalogSchema = z.object({
  /** Section order is the coverage doc and panel order; `intro` is doc prose only. */
  sections: z.array(z.object({ name: z.string().min(1), intro: z.array(z.string()).optional() }).strict()).min(1),
  commands: z.array(commandSchema).min(1),
}).strict();

export type ZplCommandEntry = z.infer<typeof commandSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogSection = Catalog["sections"][number];
