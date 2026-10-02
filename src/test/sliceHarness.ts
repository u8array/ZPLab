import { createStore, type StateCreator } from "zustand/vanilla";
import type { LabelState } from "../store/labelStore";

/** One slice on its own store. Sibling slices are absent, so only actions on its own state fit. */
export function makeSlice<S>(create: StateCreator<LabelState, [], [], S>): { get: () => S } {
  const store = createStore<S>()(create as unknown as StateCreator<S>);
  return { get: store.getState };
}
