// Types for the node-only PE helpers, so peScripts.test.ts can import them under the app tsconfig.
export declare function certificateTable(image: Buffer): { offset: number; length: number } | undefined;
export declare function withoutCertificateTable(image: Buffer): Buffer;
export declare function stripCertificateTable(file: string): void;
export declare function hasCertificateTable(file: string): boolean;
