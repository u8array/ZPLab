import type { Translations } from "../../locales";
import { aiSpec, type Gs1SetError } from "@zplab/core/lib/gs1";

export type Gs1BuilderStrings = Translations["gs1builder"];

/** Localized AI display name: per-AI key, else the decimal family's shared
 *  key, else the catalog EN title, else the AI number. */
export function aiName(tg: Gs1BuilderStrings, ai: string): string {
  const loc = tg as Record<string, string>;
  const spec = aiSpec(ai);
  const family = spec?.kind === "decimal" ? loc[`aiNameFamily${ai.slice(0, 3)}`] : undefined;
  // `||` on the title so an empty catalog title (8110/8112) still falls to the AI number.
  return loc[`aiName${ai}`] ?? family ?? (spec?.title || ai);
}

export function fieldErrMsg(tg: Gs1BuilderStrings, code: string): string {
  return (tg as Record<string, string>)[`err${code.charAt(0).toUpperCase()}${code.slice(1)}`] ?? code;
}

export function setErrMsg(tg: Gs1BuilderStrings, e: Gs1SetError): string {
  if (e.key === "exclusiveAis")
    return tg.errExclusiveFmt.replace("{a}", e.ai).replace("{b}", e.other);
  if (e.key === "missingRequired")
    return tg.errRequiresFmt
      .replace("{ai}", e.ai)
      .replace("{list}", e.alternatives.map((alt) => alt.map((m) => `(${m})`).join("+")).join(" / "));
  return fieldErrMsg(tg, e.key);
}
