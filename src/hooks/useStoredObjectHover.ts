import { createContext, useContext } from "react";

export interface StoredObjectHover {
  /** A storage key, resolved against the current listing, so a row that is gone marks nothing. */
  hoveredKey: string | undefined;
  setHoveredKey: (key?: string) => void;
}

/** The lists and the drive bars sit in different subtrees, so one hover needs a shared slot. */
export const StoredObjectHoverContext = createContext<StoredObjectHover | null>(null);

/** Outside the provider a list still renders, it just reports its hover to nobody. */
export function useStoredObjectHover(): StoredObjectHover {
  return useContext(StoredObjectHoverContext) ?? { hoveredKey: undefined, setHoveredKey: () => undefined };
}
