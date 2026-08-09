import { describe, expect, it } from "vitest";
import en from "./en";
import { isLocaleCode, LOCALE_CODES, loadLocale } from "./index";

/** Dotted key paths of every leaf; arrays count as leaves. */
function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe("locale registry", () => {
  it("caches loaded locales (same identity on repeat loads)", async () => {
    const a = await loadLocale("de");
    const b = await loadLocale("de");
    expect(b).toBe(a);
  });

  it("rejects prototype keys as locale codes", () => {
    expect(isLocaleCode("constructor")).toBe(false);
    expect(isLocaleCode("toString")).toBe(false);
    expect(isLocaleCode("de")).toBe(true);
  });

  // Own timeout: 33 dynamic locale imports are transform-bound, and the default
  // 5s is a coin flip once the rest of the suite runs alongside them.
  it("every locale matches the en key structure exactly", { timeout: 30_000 }, async () => {
    // Replaces the compile-time guarantee the old eager map gave implicitly;
    // deep both-direction parity so a missing OR extra key fails per locale.
    const enKeys = keyPaths(en as unknown as Record<string, unknown>).sort();
    for (const code of LOCALE_CODES) {
      const t = await loadLocale(code);
      expect(
        keyPaths(t as unknown as Record<string, unknown>).sort(),
        `locale ${code} diverges from en key structure`,
      ).toEqual(enKeys);
    }
  });
});
