import { describe, it, expect } from "vitest";
import { gfShipsSafely } from "./image";

// Every payload a review round found reaching the wire, kept together so a
// later change to the guard cannot quietly reopen one of them. The guard has
// been rebuilt several times (byte counts, a whitelist, wire-byte offsets) and
// each rebuild closed one shape while opening another; this is the corpus that
// makes that visible in one run.
describe("payloads that must never ship verbatim", () => {
  const REFUSED: [string, string][] = [
    ["no byte count at all", "^GFB,,,1,^XZ^XA^JUS^XZ"],
    ["format A carries a caret", "^GFA,1,1,1,00^XZ^XA^JUF"],
    ["commands past the declared count", "^GFB,4,4,2,AAAA^XZ^XA~JB"],
    // c is the DECOMPRESSED size for format C, so it can never bound the wire.
    ["compressed, c standing in for b", `^GFC,,4096,80,${"A".repeat(40)}^XZ${"B".repeat(36)}`],
    ["header carrying no data", "^GFB,8,8,1,"],
    ["bare header, no payload at all", "^GFA,8,8,1"],
    ["not a ^GF command", "^XZ"],
    ["a bare device command", "~JB"],
    ["unreadable header with a caret", "^GFA, 8, 8, 1, FF^XZ"],
  ];

  for (const [name, payload] of REFUSED) {
    it(`refuses: ${name}`, () => {
      expect(gfShipsSafely(payload)).toBe(false);
    });
  }
});

describe("payloads the importer preserves and that must keep shipping", () => {
  const ACCEPTED: [string, string][] = [
    ["plain hex", "^GFA,4,4,2,FF00FF00"],
    ["the wrapper the parser writes", "^GFB,4,4,2,:B64:AAAA:9c02"],
    ["control bytes inside the declared count", "^GFB,4,4,2,A^B~"],
    ["under-read payload, count over-declared", "^GFB,9999,9999,10,AB"],
    // Looks like a hole and is not: the firmware still owes itself 1e20 bytes,
    // so it eats everything following AS DATA and the ^XZ never executes. A
    // broken label, which is what the source stream already said, not a command.
    ["a count no payload could ever satisfy", "^GFB,99999999999999999999,8,1,AB^XZ"],
    ["no count, clean payload", "^GFB,,,2,ABCD"],
    // What our own encoder writes for a 4x6in label at 8 dpmm. A spec-range
    // gate on b/c silently emptied exactly this.
    ["a full-size graphic our encoder emits", `^GFA,124236,124236,102,${"F".repeat(20)}`],
  ];

  for (const [name, payload] of ACCEPTED) {
    it(`ships: ${name}`, () => {
      expect(gfShipsSafely(payload)).toBe(true);
    });
  }
});
