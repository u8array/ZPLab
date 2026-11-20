import { isIP } from "node:net";
import { z } from "zod";
import { schemaToolError, type ToolError } from "@zplab/headless";

const printerSchema = z.strictObject({
  // The id is a path segment of the printer routes.
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "must be 1 to 64 letters, digits, - or _"),
  name: z.string().min(1).optional(),
  host: z.string().refine((host) => isIP(host) === 6 || /^[^\s/:]+$/.test(host), "must be a host name or an address, without a scheme or a port"),
  port: z.number().int().min(1).max(65535).default(9100),
});

export interface Printer {
  id: string;
  name: string;
  host: string;
  port: number;
}

export type Printers = ReadonlyMap<string, Printer>;

/** The printer list from its JSON text. Unset or empty means no printers. */
export function parsePrinters(raw: string | undefined): { ok: true; printers: Printers } | ToolError {
  if (!raw?.trim()) return { ok: true, printers: new Map() };
  let listed: unknown;
  try {
    listed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["not JSON"] };
  }
  const parsed = z.array(printerSchema).safeParse(listed);
  if (!parsed.success) return schemaToolError(parsed.error, "printers");
  const printers = new Map<string, Printer>();
  for (const { id, name = id, host, port } of parsed.data) {
    if (printers.has(id)) return { ok: false, errors: [`printer id "${id}" is listed twice`] };
    printers.set(id, { id, name, host, port });
  }
  return { ok: true, printers };
}
