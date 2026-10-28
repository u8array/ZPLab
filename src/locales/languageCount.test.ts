import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALE_CODES } from "./index";

// The two prose registries that state the language count by hand.
const FILES = ["README.md", "src-tauri/packaging/linux/de.u8array.zplab.metainfo.xml"];

describe("the stated language count", () => {
  it.each(FILES)("%s states the registered locale count", (file) => {
    expect(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")).toContain(`${LOCALE_CODES.length} interface languages`);
  });
});
