import { describe, it, expect } from "vitest";
import { z } from "zod";
import { schemaIssues } from "./schemaIssues";

const leaf = z.object({ id: z.string(), x: z.number(), y: z.number(), rotation: z.number(), props: z.object({ content: z.string() }) });
const schema = z.object({
  label: z.object({ widthMm: z.number(), heightMm: z.number(), dpmm: z.number() }),
  pages: z.array(z.object({ objects: z.array(z.union([leaf, z.object({ id: z.string(), children: z.array(leaf) })])) })),
});

const label = { widthMm: 1, heightMm: 1, dpmm: 1 };
/** Four issues: id, x, y, props.content. */
const broken = { id: 1, x: "a", y: "b", rotation: 0, props: { content: 1 } };

const issuesOf = (value: unknown) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("fixture parses");
  return schemaIssues(parsed.error, "design");
};
const paths = (issues: string[]) => issues.map((line) => line.split(":")[0]);

describe("schemaIssues", () => {
  it("lists one cause per broken object first and admits what it cut", () => {
    const issues = issuesOf({ label: { ...label, widthMm: "wide" }, pages: [{ objects: [broken, broken, broken, broken, broken, broken] }] });
    expect(paths(issues)).toEqual([
      "label.widthMm",
      "pages.0.objects.0.id",
      "pages.0.objects.1.id",
      "pages.0.objects.2.id",
      "pages.0.objects.3.id",
      "and 20 more issues",
    ]);
  });

  it("names every broken object before any object's second field", () => {
    const issues = issuesOf({ label: { widthMm: "a", heightMm: "b", dpmm: "c" }, pages: [{ objects: [broken, broken] }] });
    expect(paths(issues)).toEqual([
      "label.widthMm",
      "pages.0.objects.0.id",
      "pages.0.objects.1.id",
      "label.heightMm",
      "label.dpmm",
      "and 6 more issues",
    ]);
  });

  it("keys a group's children as elements of their own", () => {
    const issues = issuesOf({ label, pages: [{ objects: [{ id: "g", children: [broken, broken] }] }] });
    expect(paths(issues)).toEqual([
      "pages.0.objects.0.children.0.id",
      "pages.0.objects.0.children.1.id",
      "pages.0.objects.0.children.0.x",
      "pages.0.objects.0.children.0.y",
      "pages.0.objects.0.children.0.props.content",
      "and 3 more issues",
    ]);
  });

  it("counts a single hidden issue in the singular", () => {
    const issues = issuesOf({ label: { ...label, widthMm: "a", heightMm: "b" }, pages: [{ objects: [broken] }] });
    expect(issues[5]).toBe("and 1 more issue");
  });

  it("fills the free places with an object's other fields, without a marker", () => {
    const issues = issuesOf({ label, pages: [{ objects: [broken] }] });
    expect(paths(issues)).toEqual(["pages.0.objects.0.id", "pages.0.objects.0.x", "pages.0.objects.0.y", "pages.0.objects.0.props.content"]);
  });

  it("names a top-level failure by its root", () => {
    const parsed = z.object({ a: z.number() }).safeParse(5);
    if (parsed.success) throw new Error("fixture parses");
    expect(schemaIssues(parsed.error, "design")).toEqual([expect.stringMatching(/^design: /)]);
  });
});
