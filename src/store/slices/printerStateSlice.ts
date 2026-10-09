import type { StateCreator } from 'zustand';
import { adoptionPatches, type AdoptionRow } from '@zplab/core/lib/printerSettingsAdoption';
import { SGD_ALL_SETTINGS, sgdGetvarCommand, type SgdSetting } from '@zplab/core/lib/sgd';
import type { PrinterOutcome, PrinterQueryFailure } from '../../lib/printerQuery';
import { readPrinterSettings as querySettings } from '../../lib/printerSettings';
import { readPrinterConfiguration as queryConfiguration, readPrinterStatus, type PrinterStatusReport } from '../../lib/printerStatus';
import { queryKeyFor, resolveQueryTarget, type PrintTransport } from '../../lib/printTarget';
import type { LabelState } from '../labelStore';
import { selectEditorFrozen } from '../labelStore.selectors';
import { overPrinterChannel } from '../printerChannel';
import { densityRescalePatch, labelConfigPatch } from './labelConfigSlice';
import { applyProfilePatch } from './printerProfileSlice';

export type PrinterState =
  | { phase: 'idle' }
  | { phase: 'done'; key: string; at: number; report: PrinterStatusReport }
  | { phase: 'failed'; key: string; at: number; failure: PrinterQueryFailure };

export interface PrinterStateSlice {
  printerState: PrinterState;
  /** The command on the wire, so no second read starts over the one channel meanwhile. */
  printerReading: string | undefined;
  /** `transport` overrides the stored way with the dialog tab. */
  checkPrinter: (transport?: PrintTransport) => Promise<PrinterOutcome<PrinterStatusReport> | undefined>;
  /** ^HH as text. The echo is handed back, not kept. */
  readPrinterConfiguration: () => Promise<PrinterOutcome<string>>;
  /** Every setting the printer reports. */
  readPrinterSettings: () => Promise<PrinterOutcome<SgdSetting[]>>;
  /** Writes the chosen rows into the label settings and the printer profile. False when the store refused them. */
  adoptPrinterSettings: (rows: readonly AdoptionRow[]) => boolean;
}

export const createPrinterStateSlice: StateCreator<LabelState, [], [], PrinterStateSlice> = (set, get) => ({
  printerState: { phase: 'idle' },
  printerReading: undefined,

  checkPrinter: (transport) => {
    const stored = get().printTarget;
    const resolved = resolveQueryTarget(stored, transport);
    const key = queryKeyFor(stored, transport);
    return overPrinterChannel(get, set, '', async () => {
      if ('failure' in resolved) {
        set({ printerState: { phase: 'failed', key, at: Date.now(), failure: resolved.failure } });
        return undefined;
      }
      const result = await readPrinterStatus(resolved.target, (step) => set({ printerReading: step }));
      set({
        printerState:
          result.kind === 'ok' ? { phase: 'done', key, at: Date.now(), report: result.value } : { phase: 'failed', key, at: Date.now(), failure: result },
      });
      return result;
    });
  },

  readPrinterConfiguration: () => {
    const resolved = resolveQueryTarget(get().printTarget);
    return overPrinterChannel(get, set, '^HH', () => ('failure' in resolved ? Promise.resolve(resolved.failure) : queryConfiguration(resolved.target)));
  },

  readPrinterSettings: () => {
    const resolved = resolveQueryTarget(get().printTarget);
    return overPrinterChannel(get, set, sgdGetvarCommand(SGD_ALL_SETTINGS), () => ('failure' in resolved ? Promise.resolve(resolved.failure) : querySettings(resolved.target)));
  },

  adoptPrinterSettings: (rows) => {
    const state = get();
    if (selectEditorFrozen(state)) return false;
    const { label, profile } = adoptionPatches(rows);
    const { dpmm, ...rest } = label;
    // A new density reinterprets every dot value in the design, so the whole patch goes through the rescale seam.
    const labelPatch = dpmm !== undefined && dpmm !== state.label.dpmm ? densityRescalePatch(state, dpmm, rest) : labelConfigPatch(state, rest);
    const profilePatch = Object.keys(profile).length > 0 ? applyProfilePatch(state, () => profile) : {};
    if (profilePatch === null) return false;
    const next = { ...labelPatch, ...profilePatch };
    // The label and the profile land in one step, so one undo takes both back.
    if (Object.keys(next).length > 0) set(next);
    return true;
  },
});
