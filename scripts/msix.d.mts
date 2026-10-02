// Types for the node-only MSIX helpers, so the parity test can import them under the app tsconfig.
export declare function readManifest(): string;
export declare function storeVersion(version: string): string;
export declare function packageVersion(store: string): string;
export declare function stampVersion(manifest: string, version: string): string;
export declare function manifestExecutable(manifest: string): string | undefined;
