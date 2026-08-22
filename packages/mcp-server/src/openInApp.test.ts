import { markAppAttached } from "./appBridge";
import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./server";
import { openInApp } from "./tools";
import { resolveDraftReceipt } from "./appBridge";
import { designFile } from "./testFixtures";
import { CURRENT_DESIGN_SCHEMA_VERSION } from "@zplab/core/lib/designFile";

async function connect(server: ReturnType<typeof buildServer>): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

describe("open_in_app gating", () => {
  it("is absent from the stdio build's tool list", async () => {
    const client = await connect(buildServer());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("open_in_app");
  });

  it("is listed and reports the app's receipt when app-spawned", async () => {
    markAppAttached("session-test");
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      const client = await connect(buildServer({ hosted: true }));
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("open_in_app");

      const call = client.callTool({
        name: "open_in_app",
        arguments: { designFile },
      }) as Promise<{ content: { type: string; text: string }[] }>;

      // Stand in for the app: read the id off the event line and confirm.
      const line = await vi.waitUntil(() => writes[0]);
      const parsed = JSON.parse(line.trim()) as { zplabEvent: string; id: number; designFile: unknown };
      expect(parsed.zplabEvent).toBe("openDraft");
      // Forwarded migrated + defaults-filled, so the app never re-migrates.
      expect(parsed.designFile).toEqual({ ...designFile, schemaVersion: CURRENT_DESIGN_SCHEMA_VERSION });
      expect(resolveDraftReceipt({ id: parsed.id, ok: true })).toBe(true);

      const res = await call;
      expect(JSON.parse(res.content[0]?.text ?? "{}")).toEqual({ ok: true, replaced: { objects: 0, undoHistoryCleared: true } });
    } finally {
      spy.mockRestore();
    }
  });

  it("surfaces the app's rejection instead of claiming success", async () => {
    markAppAttached("session-test");
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      const client = await connect(buildServer({ hosted: true }));
      const call = client.callTool({
        name: "open_in_app",
        arguments: { designFile },
      }) as Promise<{ content: { type: string; text: string }[] }>;
      const line = await vi.waitUntil(() => writes[0]);
      const { id } = JSON.parse(line.trim()) as { id: number };
      resolveDraftReceipt({ id, ok: false, error: "the editor refused the draft" });

      const res = await call;
      expect(JSON.parse(res.content[0]?.text ?? "{}")).toEqual({
        ok: false,
        errors: ["the editor refused the draft"],
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("openInApp validation", () => {
  it("passes a valid design file through", () => {
    const result = openInApp(designFile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.designFile).toEqual({ ...designFile, schemaVersion: CURRENT_DESIGN_SCHEMA_VERSION });
  });

  it("returns errors for a malformed design file", () => {
    const result = openInApp({ schemaVersion: 3, label: { widthMm: 10 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
