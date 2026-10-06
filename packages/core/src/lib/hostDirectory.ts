import { FONT_FORMAT_BY_EXT } from "./customFonts";
import { replyLines, unframed } from "./hostStatus";

export interface HostObject {
  device: string;
  name: string;
  ext: string;
  size: number;
}

export interface HostDirectory {
  device: string;
  objects: HostObject[];
  bytesFree: number | undefined;
}

export const hostObjectPath = (o: HostObject): string => `${o.device}:${o.name}.${o.ext}`;

export type HostObjectKind = "graphic" | "font" | "format" | "other";

/** Extensions by what the object is, after the object lists of spec p.243 and p.182. */
export function hostObjectKind(ext: string): HostObjectKind {
  if (ext === "GRF" || ext === "PNG") return "graphic";
  if (ext in FONT_FORMAT_BY_EXT) return "font";
  if (ext === "ZPL") return "format";
  return "other";
}

// The ZD230 (V89.21.46Z) prints names of 16 characters and a dash in them, so the columns are read by pattern, not by the widths of spec p.240.
// The charset stays the device's own, so a reply can never smuggle a command into the ^HG or ^ID built from a listed object.
const OBJECT_LINE = /^\*\s*([A-Z]):([A-Z0-9_-]+)\.([A-Z0-9]+)\s+(\d+)/i;
// Spec p.240 shows the head without the dash the example on p.241 prints.
const DIR_LINE = /^-?\s*DIR\s+([A-Z]):/i;
const FREE_LINE = /^-?\s*(\d+)\s+bytes free/i;

/** ^HW answers one STX block per drive: a DIR head, one line per object, a bytes-free foot (spec p.240). */
export function parseHostDirectories(body: string): HostDirectory[] {
  const out: HostDirectory[] = [];
  let current: HostDirectory | undefined;
  for (const line of replyLines(body)) {
    const [, drive = ""] = DIR_LINE.exec(line) ?? [];
    if (drive) {
      current = { device: drive.toUpperCase(), objects: [], bytesFree: undefined };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const [, device = "", name = "", ext = "", size = ""] = OBJECT_LINE.exec(line) ?? [];
    if (name) {
      current.objects.push({ device: device.toUpperCase(), name: name.toUpperCase(), ext: ext.toUpperCase(), size: Number(size) });
      continue;
    }
    const [, free = ""] = FREE_LINE.exec(line) ?? [];
    if (free) current.bytesFree = Number(free);
  }
  return out;
}

export interface HostGraphic {
  name: string;
  /** A whole ^GFA command, so the preview decoder reads it unchanged. */
  gfa: string;
}

/** ^HG answers in ~DG form (spec p.175), on the ZD230 for PNG objects too, with a bare name, no drive and no extension. */
export function parseHostGraphic(body: string): HostGraphic | undefined {
  const [, name = "", total = "", row = "", payload = ""] = /~DG([^,]*),(\d+),(\d+),([\s\S]*)$/.exec(unframed(body).trim()) ?? [];
  if (!(Number(total) > 0) || !(Number(row) > 0)) return undefined;
  return { name, gfa: `^GFA,${total},${total},${row},${payload.replaceAll(/[\r\n]/g, "")}` };
}
