import { useEffect, useState } from "react";
import { exportPrinterImpact, type PrinterImpact } from "../lib/exportImpact";

/** Printer impact of a ZPL string, computed off the commit; the last result
 *  survives edits so the warning doesn't blink, disabling clears it. */
export function usePrinterImpact(zpl: string, enabled: boolean): PrinterImpact | null {
  const [impact, setImpact] = useState<PrinterImpact | null>(null);
  useEffect(() => {
    const id = setTimeout(
      () => setImpact(enabled && zpl !== "" ? exportPrinterImpact(zpl) : null),
      0,
    );
    return () => clearTimeout(id);
  }, [enabled, zpl]);
  // Synchronous on disable: a deferred clear would flash the banner over a fresh session.
  return enabled ? impact : null;
}
