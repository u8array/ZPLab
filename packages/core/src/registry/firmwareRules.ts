/** The 6 UPC-E data digits, without number system and check digit. */
function upceData6(content: string): string {
  return content.replace(/\D/g, "").slice(0, 6).padEnd(6, "0");
}

/** A ^B9 payload of 7 or 8 digits drops the leading number-system digit before the 6 data digits. */
export function upceData6FromFd(fd: string): string {
  const digits = fd.replace(/\D/g, "");
  return upceData6(digits.length >= 7 ? digits.slice(1) : digits);
}

/** UPC-E in its canonical 7-digit form: number system 0 plus 6 data digits. */
export const upceCanonical = (content: string): string => `0${upceData6FromFd(content)}`;

/** PLANET digits filled to the 11 or 13 that bwip can draw. */
export function planetData(content: string): string {
  const digits = content.replace(/\D/g, "") || "0";
  if (digits.length < 11) return digits.padStart(11, "0");
  return digits.length === 12 ? digits.padStart(13, "0") : digits;
}

const ALL_DIGITS = /^[0-9]+$/;

/** ZD230-measured: short EAN and UPC-A data is zero-filled on the left. One surplus digit is the check digit the printer recomputes. */
export function fixedDigits(content: string, length: number): string {
  if (!ALL_DIGITS.test(content) || content.length > length + 1) return content;
  return content.slice(0, length).padStart(length, "0");
}

/** ZD230-measured: ^BS encodes up to two digits as the 2-digit supplement and longer data as its first five digits. */
export function supplementData(content: string): string {
  if (!ALL_DIGITS.test(content)) return content;
  return content.length <= 2 ? content.padStart(2, "0") : content.slice(0, 5).padStart(5, "0");
}

/** ZD230-measured for a to z. Other letters pass through and the encoder refuses them. */
export const upperAZ = (content: string): string => content.replace(/[a-z]/g, (c) => c.toUpperCase());
