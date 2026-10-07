import { useState, type ReactNode } from "react";
import { StoredObjectHoverContext } from "../../hooks/useStoredObjectHover";

export function StoredObjectHoverProvider({ children }: { children: ReactNode }) {
  const [hoveredKey, setHoveredKey] = useState<string>();
  return <StoredObjectHoverContext.Provider value={{ hoveredKey, setHoveredKey }}>{children}</StoredObjectHoverContext.Provider>;
}
