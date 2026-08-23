import type { StateCreator } from 'zustand';
import {
  EMPTY_PRINTER_PROFILE,
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
  patchPrinterProfile: (patch: Partial<PrinterProfile>) => void;
  /** Clear every field (back to "printer defaults apply everywhere").
   *  Setup-Script preview's Clear action; emits no ^XA/^XZ output
   *  until a field is set again. */
  resetPrinterProfile: () => void;
}

export const createPrinterProfileSlice: StateCreator<
  LabelState,
  [],
  [],
  PrinterProfileSlice
> = (set) => ({
  printerProfile: EMPTY_PRINTER_PROFILE,

  patchPrinterProfile: (patch) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      // Drop keys explicitly set to `undefined` so the profile stays
      // "field absent = printer default" rather than "field present with
      // undefined". Validate the merged result through the schema so the
      // cross-field rule (clockMode === 'TOL' ↔ clockTolerance defined)
      // can't be violated from any caller.
      const merged = pruneUndefined<PrinterProfile>({
        ...state.printerProfile,
        ...patch,
      });
      // Repair cross-field invariants at the store boundary so any
      // caller (UI partial patch, import, undo replay) gets them for
      // free. Direction follows patch intent; see normalizeMaintenanceTypes.
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
        return {};
      }
      return { printerProfile: parsed.data };
    }),

  resetPrinterProfile: () =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      return { printerProfile: {} };
    }),
});
