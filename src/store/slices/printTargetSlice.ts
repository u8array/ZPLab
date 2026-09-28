import type { StateCreator } from 'zustand';
import { DEFAULT_PRINT_TARGET, type PrintTarget } from '../../lib/printTarget';
import type { LabelState } from '../labelStore';

export interface PrintTargetSlice {
  /** Per installation like the renderer choice, so it rides the session and never the undo history or a design file. */
  printTarget: PrintTarget;
  setPrintTarget: (patch: Partial<PrintTarget>) => void;
}

export const createPrintTargetSlice: StateCreator<LabelState, [], [], PrintTargetSlice> = (set) => ({
  printTarget: DEFAULT_PRINT_TARGET,
  setPrintTarget: (patch) => set((state) => ({ printTarget: { ...state.printTarget, ...patch } })),
});
