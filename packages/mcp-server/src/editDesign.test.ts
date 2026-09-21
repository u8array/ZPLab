import { describe, it, expect, vi } from "vitest";
import { buildServer } from "./server";
import { buildEditDesignResult, createDraft } from "./tools";
import { markAppAttached, resolveEditReceipt } from "./appBridge";
import { connect, spyStdout } from "./testFixtures";

const designAfter = () => {
  const created = createDraft({
    widthMm: 60, heightMm: 40, dpmm: 8,
    objects: [{ type: "text", id: "t1", x: 10, y: 10, props: { content: "edited" } }, { type: "text", x: 10, y: 60, props: { content: "new" } }],
  });
  if (!created.ok) throw new Error("fixture");
  return created.designFile as unknown as Record<string, unknown>;
};

type ToolReply = Promise<{ content: { type: string; text: string }[] }>;

describe("edit_design", () => {
  it("is absent from the stdio build's tool list", async () => {
    const client = await connect(buildServer());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("edit_design");
  });

  it("sends the ops only and answers with the report the app measured, never an envelope", async () => {
    markAppAttached("session-test");
    const { writes, restore } = spyStdout();
    try {
      const client = await connect(buildServer({ hosted: true }));
      const operations = [
        { op: "update", id: "t1", props: { content: "edited" } },
        { op: "add", object: { type: "text", x: 10, y: 60, props: { content: "new" } } },
      ];
      const call = client.callTool({ name: "edit_design", arguments: { operations } }) as ToolReply;
      const line = await vi.waitUntil(() => writes[0]);
      const parsed = JSON.parse(line.trim()) as { zplabEvent: string; id: number; operations: unknown[]; designFile?: unknown };
      expect(parsed.zplabEvent).toBe("editRequest");
      expect(parsed.operations).toEqual(operations);
      expect(parsed.designFile).toBeUndefined();
      expect(resolveEditReceipt({ id: parsed.id, ok: true, designFile: designAfter(), assignedIds: { 1: "text-2" }, capturesLost: [], capturesAtRisk: [] })).toBe(true);

      const res = JSON.parse((await call).content[0]?.text ?? "{}") as Record<string, unknown>;
      expect(res).toMatchObject({ ok: true, applied: 2, added: [{ opIndex: 1, id: "text-2" }] });
      expect(res.designFile).toBeUndefined();
      expect(Array.isArray(res.bounds)).toBe(true);
    } finally {
      restore();
    }
  });

  it("hands the app's refusal back with the op it named", async () => {
    markAppAttached("session-test");
    const { writes, restore } = spyStdout();
    try {
      const client = await connect(buildServer({ hosted: true }));
      const call = client.callTool({ name: "edit_design", arguments: { operations: [{ op: "remove", id: "ghost" }] } }) as ToolReply;
      const line = await vi.waitUntil(() => writes[0]);
      const { id } = JSON.parse(line.trim()) as { id: number };
      resolveEditReceipt({ id, ok: false, errors: ["No object with id ghost"], opIndex: 0 });
      expect(JSON.parse((await call).content[0]?.text ?? "{}")).toEqual({ ok: false, errors: ["No object with id ghost"], opIndex: 0 });
    } finally {
      restore();
    }
  });
});

describe("buildEditDesignResult", () => {
  it("names the captures an edit costs", () => {
    const result = buildEditDesignResult(
      { id: 1, ok: true, designFile: designAfter(), capturesLost: [0], capturesAtRisk: [] },
      [{ op: "update", id: "t1", props: { content: "edited" } }],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes?.some((n) => n.startsWith("page 1:") && n.includes("structural edit"))).toBe(true);
    const atRisk = buildEditDesignResult({ id: 2, ok: true, designFile: designAfter(), capturesLost: [], capturesAtRisk: [0] }, []);
    expect(atRisk.ok && atRisk.notes?.some((n) => n.startsWith("page 1:") && n.includes("around an edit"))).toBe(true);
  });

  it("tells the agent not to retry when the applied edit could not be reported", () => {
    const result = buildEditDesignResult({ id: 1, ok: true, designFile: { not: "a design" } }, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/Do not retry/);
  });
});
