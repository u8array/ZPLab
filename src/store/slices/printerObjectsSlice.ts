import type { StateCreator } from 'zustand';
import { hostObjectPath, type HostDirectory, type HostGraphic, type HostObject } from '@zplab/core/lib/hostDirectory';
import type { PrinterOutcome, PrinterQueryFailure } from '../../lib/printerQuery';
import { deletePrinterObject, readPrinterGraphic, readPrinterObjects } from '../../lib/printerObjects';
import { queryKeyFor, resolveQueryTarget, type QueryTarget } from '../../lib/printTarget';
import type { LabelState } from '../labelStore';
import { overPrinterChannel } from '../printerChannel';

export type PrinterObjectsState =
  | { phase: 'idle' }
  | { phase: 'done'; key: string; at: number; directories: HostDirectory[] }
  | { phase: 'failed'; key: string; at: number; failure: PrinterQueryFailure };

export interface PrinterObjectsSlice {
  printerObjects: PrinterObjectsState;
  readPrinterObjects: () => Promise<void>;
  readPrinterGraphic: (object: HostObject) => Promise<PrinterOutcome<HostGraphic>>;
  /** The fresh listing tells whether the printer took the delete (spec p.246 ignores unknown names). */
  deletePrinterObject: (object: HostObject) => Promise<PrinterQueryFailure | undefined>;
}

export const createPrinterObjectsSlice: StateCreator<LabelState, [], [], PrinterObjectsSlice> = (set, get) => {
  const list = async (target: QueryTarget, key: string) => {
    const result = await readPrinterObjects(target, (step) => set({ printerReading: step }));
    set({
      printerObjects:
        result.kind === 'ok' ? { phase: 'done', key, at: Date.now(), directories: result.value } : { phase: 'failed', key, at: Date.now(), failure: result },
    });
    return result;
  };
  return {
    printerObjects: { phase: 'idle' },

    readPrinterObjects: async () => {
      const stored = get().printTarget;
      const resolved = resolveQueryTarget(stored);
      const key = queryKeyFor(stored);
      await overPrinterChannel(get, set, '^HW', async () => {
        if ('failure' in resolved) set({ printerObjects: { phase: 'failed', key, at: Date.now(), failure: resolved.failure } });
        else await list(resolved.target, key);
      });
    },

    readPrinterGraphic: (object) => {
      const resolved = resolveQueryTarget(get().printTarget);
      return overPrinterChannel(get, set, '^HG', () => ('failure' in resolved ? Promise.resolve(resolved.failure) : readPrinterGraphic(resolved.target, object)));
    },

    deletePrinterObject: (object) => {
      const stored = get().printTarget;
      const resolved = resolveQueryTarget(stored);
      return overPrinterChannel(get, set, '^ID', async () => {
        if ('failure' in resolved) return resolved.failure;
        const failure = await deletePrinterObject(resolved.target, object);
        if (failure) return failure;
        const listing = await list(resolved.target, queryKeyFor(stored));
        const path = hostObjectPath(object);
        const kept = listing.kind === 'ok' && listing.value.some((d) => d.objects.some((o) => hostObjectPath(o) === path));
        return kept ? { kind: 'ignored' } : undefined;
      });
    },
  };
};
