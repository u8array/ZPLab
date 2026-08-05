// Minimal node-build surface for the type-checked test helpers; the full
// package resolves no types under the bundler moduleResolution.
declare module "bwip-js" {
  const bwipjs: {
    toBuffer(opts: object, cb: (err: string | Error, png: Buffer) => void): void;
    raw(opts: object): unknown;
  };
  export default bwipjs;
}
