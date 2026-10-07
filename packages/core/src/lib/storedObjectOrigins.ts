import { hostObjectKind, hostObjectPath, type HostDirectory, type HostObject, type HostObjectKind } from "./hostDirectory";
import { isWritableDevice, splitStorageKey, storageKey } from "./storagePath";

export type StoredObjectKind = Extract<HostObjectKind, "graphic" | "font">;

export interface HostListing {
  /** Only the drives that answered for themselves, so absence on them is real. */
  devices: string[];
  objects: HostObject[];
  free: { device: string; bytesFree: number }[];
}

export function hostListing(directories: readonly HostDirectory[]): HostListing {
  // Two DIR blocks from one drive would name its free space twice.
  const perDevice = new Map<string, HostDirectory>();
  for (const dir of directories) if (!perDevice.has(dir.device)) perDevice.set(dir.device, dir);
  const blocks = [...perDevice.values()];
  return {
    // A block listing another drive's objects is an alias: it answers for the target, not for itself.
    devices: blocks.filter(namesItsOwn).map((d) => d.device),
    objects: [...new Map(blocks.flatMap((d) => d.objects).map((o) => [storageKey(hostObjectPath(o)), o])).values()].sort(firmwareLast),
    // Room is only worth naming where an upload may write.
    free: blocks.flatMap((d) =>
      d.bytesFree === undefined || !isWritableDevice(d.device) || !namesItsOwn(d) ? [] : [{ device: d.device, bytesFree: d.bytesFree }],
    ),
  };
}

const namesItsOwn = (d: HostDirectory): boolean => d.objects.every((o) => o.device === d.device);

function firmwareLast(a: HostObject, b: HostObject): number {
  return Number(!isWritableDevice(a.device)) - Number(!isWritableDevice(b.device));
}

export const listingHolds = (listing: HostListing, path: string): boolean =>
  listing.objects.some((o) => storageKey(hostObjectPath(o)) === storageKey(path));

export type HostPresence = "present" | "absent" | "unknown";

export interface StoredObjectOrigin {
  /** Keyed per drive: one name on two drives is two files. */
  key: string;
  /** The owner's own spelling, not the normalised key. */
  path: string;
  inSetup: boolean;
  /** The bytes exist off the printer too. */
  hasCopy: boolean;
  host: HostPresence;
  hostObject?: HostObject;
}

/** A file the app names. The bytes may be gone, as with a recall whose cache was cleared. */
export interface LocalObject {
  path: string;
  hasBytes: boolean;
}

export interface StoredObjectSources {
  kind: StoredObjectKind;
  setupPaths: readonly string[];
  local: readonly LocalObject[];
  listing: HostListing | undefined;
}

/** Rows run local, then setup-only, then printer-only. */
export function storedObjectOrigins({ kind, setupPaths, local, listing }: StoredObjectSources): StoredObjectOrigin[] {
  const rows = new Map<string, StoredObjectOrigin>();
  const row = (path: string): StoredObjectOrigin => {
    const key = storageKey(path);
    const found = rows.get(key);
    if (found) return found;
    const fresh: StoredObjectOrigin = { key, path, inSetup: false, hasCopy: false, host: "unknown" };
    rows.set(key, fresh);
    return fresh;
  };
  for (const object of local) row(object.path).hasCopy ||= object.hasBytes;
  // Bytes are the caller's claim, so a setup entry sets no `hasCopy`.
  for (const path of setupPaths) row(path).inSetup = true;
  for (const object of listing?.objects ?? []) {
    if (hostObjectKind(object.ext) !== kind) continue;
    const found = row(hostObjectPath(object));
    found.host = "present";
    found.hostObject = object;
  }
  if (listing) {
    for (const found of rows.values()) {
      if (found.host === "unknown" && listing.devices.includes(splitStorageKey(found.key).device)) found.host = "absent";
    }
  }
  return [...rows.values()];
}

/** `unread` means the drive never answered, so no row may claim anything. */
export type OriginState = "unread" | "missingOnPrinter" | "notOnPrinter" | "onPrinter" | "printerOnly";

export function originState(o: StoredObjectOrigin): OriginState {
  if (o.host === "unknown") return "unread";
  if (o.host === "absent") return o.inSetup ? "missingOnPrinter" : "notOnPrinter";
  return o.hasCopy ? "onPrinter" : "printerOnly";
}

export type DeleteKnowledge = "setupReuploads" | "localCopy" | "noCopy";

export function deleteKnowledge(o: StoredObjectOrigin): DeleteKnowledge {
  // A setup entry without its file restores nothing, so it counts as no copy.
  if (!o.hasCopy) return "noCopy";
  return o.inSetup ? "setupReuploads" : "localCopy";
}
