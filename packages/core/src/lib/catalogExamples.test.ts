import { describe, it, expect } from "vitest";
import { ZPL_COMMANDS, commandId } from "../catalog";
import { parseZPL } from "./zplParser";

// Lives beside the parser: the parser imports the catalog, never the other way round.
describe("catalog examples", () => {
  it("parse without an unknown command, a dropped field or a field left open", () => {
    for (const c of ZPL_COMMANDS) {
      if (!c.reference) continue;
      // The format commands show themselves in place, every other example gets the wrapper here.
      const zpl = c.reference.example.includes("^XA") ? c.reference.example : `^XA${c.reference.example}^XZ`;
      const parsed = parseZPL(zpl, 8, { captureOverlay: true });
      // Replay notes such as a lossy edit are about the overlay, not about the ZPL being valid, and the
      // parser does not model every printer command, so only a foreign unknown command counts.
      const broken = parsed.pages
        .flatMap((p) => p.findings)
        .filter((f) => (f.kind === "unknown" && !f.command.startsWith(commandId(c))) || f.kind === "unterminatedField");
      expect(broken, commandId(c)).toEqual([]);
      expect(parsed.pages.some((p) => p.overlay?.openTail), commandId(c)).toBe(false);
    }
  });
});
