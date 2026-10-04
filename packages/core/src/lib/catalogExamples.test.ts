import { describe, it, expect } from "vitest";
import { ZPL_COMMANDS, commandId } from "../catalog";
import { parseZPL } from "./zplParser";

// Lives beside the parser: the parser imports the catalog, never the other way round.
describe("catalog examples", () => {
  it("parse without an unknown command, a dropped field or a field left open", () => {
    for (const c of ZPL_COMMANDS) {
      if (!c.reference) continue;
      const parsed = parseZPL(`^XA${c.reference.example}^XZ`, 8, { captureOverlay: true });
      // Replay notes such as a lossy edit are about the overlay, not about the ZPL being valid.
      const broken = parsed.pages.flatMap((p) => p.findings).filter((f) => f.kind === "unknown" || f.kind === "unterminatedField");
      expect(broken, commandId(c)).toEqual([]);
      expect(parsed.pages.some((p) => p.overlay?.openTail), commandId(c)).toBe(false);
    }
  });
});
