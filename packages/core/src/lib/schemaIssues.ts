import type { z } from "zod";

const MAX_ISSUES = 5;

/** A union reports one opaque issue at the node. Its branch issues carry paths relative to that node. */
function flattenIssues(issues: readonly z.core.$ZodIssue[], prefix: readonly PropertyKey[] = []): { path: PropertyKey[]; message: string }[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      // The branch that got deepest into the value is the shape it was meant to take. Fewest issues breaks the tie.
      const depth = (branch: readonly z.core.$ZodIssue[]) => Math.max(0, ...branch.map((i) => i.path.length));
      const closest = [...issue.errors].sort((a, b) => depth(b) - depth(a) || a.length - b.length)[0] ?? [];
      return flattenIssues(closest, path);
    }
    return [{ path, message: issue.message }];
  });
}

/** The containing array element, else the parent object, so a broken one costs one slot, not one per field. */
function issueKey(path: readonly PropertyKey[]): string {
  const lastIndex = path.reduce<number>((last, seg, i) => (typeof seg === "number" ? i : last), -1);
  return (lastIndex >= 0 ? path.slice(0, lastIndex + 1) : path.slice(0, -1)).map(String).join(".");
}

/** Schema issues as "path: reason", the first few, one per element first. A cut list ends with how many it hides. */
export function schemaIssues(error: z.ZodError, root: string): string[] {
  const all = flattenIssues(error.issues);
  const seen = new Set<string>();
  const firsts: typeof all = [];
  const rest: typeof all = [];
  for (const issue of all) {
    const key = issueKey(issue.path);
    (seen.has(key) ? rest : firsts).push(issue);
    seen.add(key);
  }
  const ordered = [...firsts, ...rest];
  const shown = ordered.slice(0, MAX_ISSUES).map(({ path, message }) => `${path.map(String).join(".") || root}: ${message}`);
  const hidden = all.length - shown.length;
  if (hidden === 0) return shown;
  return [...shown, hidden === 1 ? "and 1 more issue" : `and ${hidden} more issues`];
}
