// Types for the node-only hash helper, so the translation test can import it under the app tsconfig.
import type { CommandReference } from "../packages/core/src/catalog/schema";

export declare function textHash(text: string): string;
export declare function referenceParamsText(reference: CommandReference): string;
export declare function referenceHash(reference: CommandReference): string;
export declare function referenceTokens(text: string): Set<string>;
