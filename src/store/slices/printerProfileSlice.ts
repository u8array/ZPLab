import type { StateCreator } from 'zustand';
import {
  changedProfileFields,
  EMPTY_PRINTER_PROFILE,
  SETUP_UPLOAD_FIELDS,
  normalizeMaintenanceTypes,
  printerProfileSchema,
  type PrinterProfile,
} from '@zplab/core/types/PrinterProfile';
import { pruneUndefined } from '@zplab/core/lib/pruneUndefined';
import { selectEditorFrozen } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';

export interface PrinterProfileSlice {
  /** EEPROM-persistent printer-state. Separate from `label` so design
   *  files (which round-trip `label`) don't leak the user's printer
   *  name, locale, clock value, etc. Single profile per installation. */
  printerProfile: PrinterProfile;
  /** Patch the active profile. Same shape as `setLabelConfig` but
   *  writes to this slice so per-installation Setup-Script fields stay
   *  out of the per-label config. */
  patchPrinterProfile: (patch: Partial<PrinterProfile>) => boolean;
  /** Patch derived from the profile at write time. False when the store refused it. */
  patchPrinterProfileWith: (make: (profile: PrinterProfile) => Partial<PrinterProfile>) => boolean;
  /** Back to printer defaults for every setting. The provisioned uploads stay, see `SETUP_UPLOAD_FIELDS`. */
  resetPrinterProfile: () => void;
}

export const createPrinterProfileSlice: StateCreator<
  LabelState,
  [],
  [],
  PrinterProfileSlice
> = (set, get) => ({
  printerProfile: EMPTY_PRINTER_PROFILE,

  patchPrinterProfile: (patch) => commitProfilePatch(get(), set, () => patch),
  patchPrinterProfileWith: (make) => commitProfilePatch(get(), set, make),

  resetPrinterProfile: () =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const kept: Partial<PrinterProfile> = {};
      for (const field of SETUP_UPLOAD_FIELDS) {
        const value = state.printerProfile[field];
        if (value) Object.assign(kept, { [field]: value });
      }
      return changedProfileFields(state.printerProfile, kept).length === 0 ? {} : { printerProfile: kept };
    }),
});

function commitProfilePatch(
  state: LabelState,
  set: (next: Partial<LabelState>) => void,
  make: (profile: PrinterProfile) => Partial<PrinterProfile>,
): boolean {
  if (selectEditorFrozen(state)) return false;
  const next = applyProfilePatch(state, make);
  if (!next) return false;
  set(next);
  return true;
}

/** The profile after a patch, or null when the schema rejects it. Writes nothing: the freeze check is the caller's. */
export function applyProfilePatch(state: LabelState, make: (profile: PrinterProfile) => Partial<PrinterProfile>): Pick<LabelState, 'printerProfile'> | null {
  const patch = make(state.printerProfile);
  // Undefined keys dropped so "field absent" stays "printer default".
  const merged = pruneUndefined<PrinterProfile>({
    ...state.printerProfile,
    ...patch,
  });
  // Repaired at the boundary so every caller gets it free, see normalizeMaintenanceTypes.
  const next = normalizeMaintenanceTypes(merged, patch);
  const parsed = printerProfileSchema.safeParse(next);
  if (!parsed.success) {
    const msg = '[printerProfile] rejected invalid patch';
    if (import.meta.env.DEV) {
      throw new Error(
        `${msg}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    console.warn(msg, parsed.error.issues, { merged: next });
    return null;
  }
  // The history compares by reference, so an unchanged profile keeps its identity or it logs a dead undo step.
  if (changedProfileFields(state.printerProfile, parsed.data).length === 0) return { printerProfile: state.printerProfile };
  return { printerProfile: parsed.data };
}
