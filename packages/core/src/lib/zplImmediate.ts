import { catalogEntry } from "../catalog";

/** Firmware intercepts an immediate command even inside field data, so such a tilde ends a field.
 *  Any other tilde is data, which is how ^BX reads its escape char. */
export function opensImmediateCommand(name: string): boolean {
  return catalogEntry(`~${name.toUpperCase()}`) !== undefined;
}
