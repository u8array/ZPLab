import { createHash } from "node:crypto";

/** The one hash scheme every catalog translation is pinned with. */
export function textHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

/** One text per reference block, so the test and the merge script pin the same English. */
export function referenceParamsText(reference) {
  return JSON.stringify(reference.params.map((p) => [p.meaning, p.values, p.default ?? ""]));
}

export function referenceHash(reference) {
  return textHash(referenceParamsText(reference));
}

/** The codes and numbers the user types, so a translation may not drop them. Two letter runs stay out: words like ID get translated. */
export function referenceTokens(text) {
  return new Set(text.match(/-?\d+(?:\.\d+)?|[\^~][A-Z@][A-Z0-9]|\b[A-Z](?=[\s,.]|$)|\b[A-Z][A-Z0-9/-]{2,}\b/g) ?? []);
}
