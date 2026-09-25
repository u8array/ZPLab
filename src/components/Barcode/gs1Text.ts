import type { Translations } from "../../locales";
import { aiSpec, gs1AddBlockReason, type Gs1SetError } from "@zplab/core/lib/gs1";
import type { DigitalLinkIssue } from "@zplab/core/lib/gs1DigitalLink";
import type { ContentFieldIssue } from "@zplab/core/lib/typedContent";

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

/** Why the element-string palette refuses an identifier, null when it does not. */
export function addBlockText(tg: Gs1BuilderStrings, ai: string, presentAis: readonly string[]): string | null {
  const block = gs1AddBlockReason(ai, presentAis);
  if (!block) return null;
  return block.kind === "duplicate" ? tg.aiAlreadyAdded : tg.aiExcludedByFmt.replace("{ai}", block.other);
}

export function linkIssueText(tc: Translations["contentBuilder"], issue: DigitalLinkIssue): string {
  switch (issue.kind) {
    case "noPrimaryKey": return tc.errGs1NoKey;
    case "twoPrimaryKeys": return tc.errGs1TwoKeys;
    case "mixedQualifiers": return tc.errGs1MixedFmt.replace("{ai}", issue.ai);
    case "duplicateAi": return tc.errGs1DuplicateFmt.replace("{ai}", issue.ai);
  }
}

/** The content builder's line under a field that breaks a rule. */
export function contentIssueText(t: Translations, issue: ContentFieldIssue): string {
  const tc = t.contentBuilder;
  switch (issue.kind) {
    case "date": return tc.errBirthday;
    case "domain": return tc.errDomain;
    case "gs1Set": return setErrMsg(t.gs1builder, issue.error);
    case "gs1Link": return linkIssueText(tc, issue.issue);
    case "gs1": return `${aiName(t.gs1builder, issue.ai)}: ${fieldErrMsg(t.gs1builder, issue.reason)}`;
  }
}
