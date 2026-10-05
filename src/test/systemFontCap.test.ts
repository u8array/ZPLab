import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { MAX_FONT_BYTES } from "@zplab/core/lib/fontCache";
import { LOCALE_CODES, loadLocale } from "../locales";

describe("the system font cap", () => {
  it("is the cache's limit in Rust and in every hint text", async () => {
    const rust = readFileSync("src-tauri/src/system_fonts.rs", "utf8").match(/const MAX_FONT_BYTES: u64 = ([^;]+);/)?.[1] ?? "";
    const product = rust.split("*").map((factor) => Number(factor.trim())).reduce((a, b) => a * b, 1);
    expect(product).toBe(MAX_FONT_BYTES);
    for (const code of LOCALE_CODES) {
      expect((await loadLocale(code)).fonts.noInstalledFonts, code).toContain(`${MAX_FONT_BYTES / 1024 / 1024} MiB`);
    }
  });
});
