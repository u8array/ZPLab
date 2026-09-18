/** Content identity for uploaded bytes. A collision would hide a replacement, so the length guards the hash. */
export function byteDigest(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  // Index loop over for-of: 1.7 ms vs 16 ms per 2 MiB font, and this runs per upload.
  // eslint-disable-next-line @typescript-eslint/prefer-for-of, @typescript-eslint/no-non-null-assertion
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return `${bytes.length}:${(h >>> 0).toString(36)}`;
}
