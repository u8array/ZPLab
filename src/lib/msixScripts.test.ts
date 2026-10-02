import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import en from "../locales/en";
import baseConfig from "../../src-tauri/tauri.conf.json";
import msixConfig from "../../src-tauri/tauri.msix.conf.json";
import { LOCALE_CODES, type LocaleCode } from "../locales";
import { manifestExecutable, packageVersion, readManifest, stampVersion, storeVersion } from "../../scripts/msix.mjs";

// Locale codes whose Store language tag is spelled differently.
const STORE_TAG: Partial<Record<LocaleCode, string>> = { en: "en-US", no: "nb", sr: "sr-Cyrl", "zh-hans": "zh-Hans", "zh-hant": "zh-Hant" };

describe("MSIX manifest", () => {
  it("declares every UI language, the default first", () => {
    const tags = [...readManifest().matchAll(/<Resource Language="([^"]+)"/g)].map((m) => m[1]);
    expect(tags[0]).toBe("en-US");
    expect([...tags].sort()).toEqual(LOCALE_CODES.map((c) => STORE_TAG[c] ?? c).sort());
  });

  it("launches the binary Tauri builds", () => {
    expect(manifestExecutable(readManifest())).toBe(`${baseConfig.mainBinaryName}.exe`);
  });

  it("stamps exactly the Identity version", () => {
    const stamped = stampVersion(readManifest(), "1.2.3.0");
    expect(stamped).toContain('Version="1.2.3.0"');
    expect(stamped).toContain('MinVersion="10.0.17763.0"');
    expect(() => stampVersion("<Package />", "1.2.3.0")).toThrow();
  });
});

describe("storeVersion", () => {
  it("shifts the major past the Store's forbidden 0 and keeps the order across 1.0", () => {
    expect(storeVersion("0.7.0")).toBe("1.7.0");
    expect(storeVersion("1.0.0")).toBe("2.0.0");
    expect(packageVersion(storeVersion("0.7.0"))).toBe("1.7.0.0");
  });

  it("rejects versions MSIX cannot express", () => {
    expect(() => storeVersion("0.8.0-beta.1")).toThrow();
    expect(() => storeVersion("1.2.70000")).toThrow();
    expect(() => storeVersion("65535.0.0")).toThrow();
    expect(storeVersion("65534.0.0")).toBe("65535.0.0");
  });
});

describe("MSIX Tauri overlay", () => {
  it("gives the Store build its own app identifier", () => {
    expect(msixConfig.identifier).not.toBe(baseConfig.identifier);
  });

  it("drops the updater the GitHub build ships", () => {
    expect(baseConfig.plugins.updater).toBeDefined();
    expect(msixConfig.plugins.updater).toBeNull();
  });
});

describe("MSIX smoke test", () => {
  it("waits for the palette search field the English UI renders", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/msix.yml", import.meta.url), "utf8");
    expect(en.palette.searchPlaceholder).toBe("Search objects\u2026");
    expect(workflow).toContain('"Search objects$([char]0x2026)"');
  });
});
