import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALE_CODES } from "../locales";
import { detectLocale } from "./labelStore.internals";

function withLanguage(lang: string): void {
  vi.stubGlobal("navigator", { language: lang });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectLocale", () => {
  it.each(LOCALE_CODES)("detects %s from a mixed-case region tag", (code) => {
    withLanguage(`${code.toUpperCase()}-zz`);
    expect(detectLocale()).toBe(code);
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
