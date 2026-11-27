import { getEntry } from "../registry";

/** The data the firmware encodes from a field, per the registry rule. */
export function firmwareData(type: string, content: string): string {
  return getEntry(type)?.firmwareData?.(content) ?? content;
}
