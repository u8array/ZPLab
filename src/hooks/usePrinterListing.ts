import { hostListing, type HostListing } from "@zplab/core/lib/storedObjectOrigins";
import { selectPrinterObjects, useLabelStore } from "../store/labelStore";

export function usePrinterListing(): HostListing | undefined {
  const state = useLabelStore(selectPrinterObjects);
  return state.phase === "done" ? hostListing(state.directories) : undefined;
}
