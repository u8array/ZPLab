import type { StateCreator } from 'zustand';
import type { PrinterOutcome, PrinterQueryFailure } from '../../lib/printerQuery';
import { readPrinterConfiguration as queryConfiguration, readPrinterStatus, type PrinterStatusReport } from '../../lib/printerStatus';
import { queryKeyFor, resolveQueryTarget, type PrintTransport } from '../../lib/printTarget';
import type { LabelState } from '../labelStore';
import { overPrinterChannel } from '../printerChannel';

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
});
