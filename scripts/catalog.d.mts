// Types for the node-only catalog loader, so the parity test can import it under the app tsconfig.
import type { Catalog, ZplCommandEntry } from "../packages/core/src/catalog/schema";

export declare const CAPABILITIES: readonly ["web", "desktop", "lint"];
export declare const commandId: (entry: ZplCommandEntry) => string;
export declare const commandIds: (entry: ZplCommandEntry) => string[];
export declare function readCatalog(): Catalog;
