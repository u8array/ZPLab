import { afterEach, describe, expect, it, vi } from "vitest";
import { detectLocale } from "./labelStore.internals";

function withLanguage(lang: string): void {
  vi.stubGlobal("navigator", { language: lang });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectLocale", () => {
  it.each(["ca", "ca-ES", "ca-AD", "CA-es"])("detects Catalan from %s", (tag) => {
    withLanguage(tag);
    expect(detectLocale()).toBe("ca");
  });

  it("maps plain two-letter tags to their locale", () => {
    withLanguage("de-DE");
    expect(detectLocale()).toBe("de");
    withLanguage("fr");
    expect(detectLocale()).toBe("fr");
  });

  it("falls back to en for unsupported languages", () => {
    withLanguage("xx-XX");
    expect(detectLocale()).toBe("en");
  });

  it("maps Chinese script subtags instead of falling through to en", () => {
    withLanguage("zh");
    expect(detectLocale()).toBe("zh-hans");
    withLanguage("zh-CN");
    expect(detectLocale()).toBe("zh-hans");
    withLanguage("zh-Hans-CN");
    expect(detectLocale()).toBe("zh-hans");
    withLanguage("zh-TW");
    expect(detectLocale()).toBe("zh-hant");
    withLanguage("zh-HK");
    expect(detectLocale()).toBe("zh-hant");
    withLanguage("zh-Hant");
    expect(detectLocale()).toBe("zh-hant");
  });

  it("maps Norwegian written standards to the no locale", () => {
    withLanguage("nb-NO");
    expect(detectLocale()).toBe("no");
    withLanguage("nn-NO");
    expect(detectLocale()).toBe("no");
  });
});
