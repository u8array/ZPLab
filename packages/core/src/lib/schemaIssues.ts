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

/** Schema issues as "path: reason", the first few. `root` names a failure at the top level. */
export function schemaIssues(error: z.ZodError, root: string): string[] {
  return flattenIssues(error.issues)
    .slice(0, MAX_ISSUES)
    .map(({ path, message }) => `${path.map(String).join(".") || root}: ${message}`);
}
