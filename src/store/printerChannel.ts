import type { LabelState } from './labelStore';

type Get = () => LabelState;
type Set = (partial: Partial<LabelState>) => void;

/** All printer reads share one channel, so a second read refuses instead of interleaving. */
export async function overPrinterChannel<T>(get: Get, set: Set, step: string, read: () => Promise<T>): Promise<T | { kind: 'busy' }> {
  if (get().printerReading !== undefined) return { kind: 'busy' };
  set({ printerReading: step });
  try {
    return await read();
  } finally {
    set({ printerReading: undefined });
  }
}
