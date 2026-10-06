import type { StateCreator } from 'zustand';
import type { PrinterOutcome, PrinterQueryFailure } from '../../lib/printerQuery';
import { readPrinterConfiguration as queryConfiguration, readPrinterStatus, type PrinterStatusReport } from '../../lib/printerStatus';
import { queryKeyFor, resolveQueryTarget, type PrintTransport } from '../../lib/printTarget';
import type { LabelState } from '../labelStore';

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
  readPrinterConfiguration: () => Promise<PrinterOutcome<string> | undefined>;
}

export const createPrinterStateSlice: StateCreator<LabelState, [], [], PrinterStateSlice> = (set, get) => ({
  printerState: { phase: 'idle' },
  printerReading: undefined,

  checkPrinter: async (transport) => {
    if (get().printerReading !== undefined) return undefined;
    const stored = get().printTarget;
    const resolved = resolveQueryTarget(stored, transport);
    const key = queryKeyFor(stored, transport);
    if ('failure' in resolved) {
      set({ printerState: { phase: 'failed', key, at: Date.now(), failure: resolved.failure } });
      return undefined;
    }
    set({ printerReading: '' });
    const result = await readPrinterStatus(resolved.target, (step) => set({ printerReading: step }));
    set({
      printerReading: undefined,
      printerState:
        result.kind === 'ok' ? { phase: 'done', key, at: Date.now(), report: result.value } : { phase: 'failed', key, at: Date.now(), failure: result },
    });
    return result;
  },

  readPrinterConfiguration: async () => {
    if (get().printerReading !== undefined) return undefined;
    const resolved = resolveQueryTarget(get().printTarget);
    if ('failure' in resolved) return resolved.failure;
    set({ printerReading: '^HH' });
    const result = await queryConfiguration(resolved.target);
    set({ printerReading: undefined });
    return result;
  },
});
