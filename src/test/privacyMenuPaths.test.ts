import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fallbackTranslations as en } from "../locales";

/** The policy sends users to a menu entry, so a renamed entry must not leave a dead path behind. */
describe("the privacy policy's menu paths", () => {
  it("names the output entry by the heading the menu uses", () => {
    const policy = readFileSync("PRIVACY.md", "utf8");

    expect(policy).toContain(`**File → ${en.zebraPrint.outputHeading}**`);
    expect(policy).not.toContain(`**File → ${en.zebraPrint.kindPrint}**`);
  });
});
