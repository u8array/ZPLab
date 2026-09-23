import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, SERVER_INSTRUCTIONS } from "./server";
import { demoLabel } from "./testFixtures";

async function connect(hosted = false): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([buildServer({ hosted }).connect(serverT), client.connect(clientT)]);
  return client;
}

describe("server handshake", () => {
  it("delivers the workflow instructions at initialize", async () => {
    const client = await connect();
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toContain("get_schema");
  });

  it("returns tool results as compact JSON (no pretty-print whitespace)", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "get_schema",
      arguments: {},
    })) as { content: { type: string; text: string }[] };
    const text = res.content[0]?.text ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\n\s+/);
  });
});

describe("an argument at the wrong level", () => {
  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    try {
      const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
      return { refused: res.isError === true, text: res.content[0]?.text ?? "" };
    } catch (e) {
      return { refused: true, text: e instanceof Error ? e.message : String(e) };
    }
  };

  it("is refused by name, with where it belongs, instead of failing the fields that were sent", async () => {
    // Replays the ticket: the design's fields landed next to designFile.
    const spilled = await call(await connect(true), "validate_draft", { designFile: { pages: [] }, schemaVersion: 6, variables: [], widthMm: 100, heightMm: 60 });
    expect(spilled.refused).toBe(true);
    for (const key of ["schemaVersion", "variables", "widthMm", "heightMm"]) expect(spilled.text).toContain(`"${key}"`);
    expect(spilled.text).toContain("go inside designFile.");
    expect(spilled.text).not.toContain("Invalid option");
  });

  it("names a stray key on create_draft and on a tool that takes nothing", async () => {
    const client = await connect(true);
    const draft = await call(client, "create_draft", { widthMm: 50, heightMm: 30, dpmm: 8, objects: [], content: "hi" });
    expect(draft.refused).toBe(true);
    expect(draft.text).toContain('unknown argument "content". This tool takes widthMm, heightMm, dpmm, storedFormatPath, objects, variables. An object\'s fields go inside its entry in objects.');
    const bare = await call(client, "get_schema", { verbose: true });
    expect(bare.refused).toBe(true);
    expect(bare.text).toContain("takes no arguments");
  });

  it("holds one level down too, where the hint sends the model", async () => {
    const client = await connect(true);
    const entry = await call(client, "create_draft", { widthMm: 50, heightMm: 30, dpmm: 8, objects: [{ type: "text", x: 1, y: 1, content: "hi" }] });
    expect(entry.refused).toBe(true);
    expect(entry.text).toContain('unknown key "content". An object entry takes');
    expect(entry.text).toContain("go inside props.");
    const op = await call(client, "patch_design", { designFile: { schemaVersion: 6, label: { widthMm: 50, heightMm: 30, dpmm: 8 }, pages: [{ objects: [] }] }, operations: [{ op: "update", id: "t", content: "NEU" }] });
    expect(op.refused).toBe(true);
    expect(op.text).toContain('unknown key "content". An update op takes');
    const variable = await call(client, "create_draft", { widthMm: 50, heightMm: 30, dpmm: 8, objects: [], variables: [{ name: "P", value: "x" }] });
    expect(variable.refused).toBe(true);
    expect(variable.text).toContain('unknown key "value". A variable takes name, defaultValue, fnNumber, comment.');
  });

  it("is what every tool's published schema says too, down to the object entry", async () => {
    const { tools } = await (await connect(true)).listTools();
    expect(tools).toHaveLength(11);
    for (const tool of tools) expect((tool.inputSchema as { additionalProperties?: boolean }).additionalProperties, tool.name).toBe(false);
    const draft = tools.find((t) => t.name === "create_draft")?.inputSchema as unknown as { properties: { objects: { items: { additionalProperties?: boolean } } } };
    expect(draft.properties.objects.items.additionalProperties).toBe(false);
  });
});

describe("the designFile argument", () => {
  const envelopeTools = ["validate_draft", "patch_design", "export_zpl", "open_in_app"];

  it("is listed as object or string on every envelope tool", async () => {
    const { tools } = await (await connect(true)).listTools();
    for (const name of envelopeTools) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const schema = tool?.inputSchema as { properties: Record<string, { anyOf?: { type: string }[] }> };
      expect(schema.properties.designFile?.anyOf?.map((v) => v.type), name).toEqual(["object", "string"]);
    }
  });

  it("passes the MCP input check as a string and reads the design", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "validate_draft",
      arguments: { designFile: JSON.stringify(demoLabel) },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0]?.text ?? "{}") as { ok: boolean; bounds: { objectId: string }[] };
    expect(body.ok).toBe(true);
    expect(body.bounds.map((b) => b.objectId)).toEqual(["titel", "preis", "hinweis", "ean", "rueck"]);
  });
});

describe("prepared workflows", () => {
  const names = async (hosted: boolean) =>
    (await (await connect(hosted)).listPrompts()).prompts.map((p) => p.name);

  it("offers the standalone ones without a window", async () => {
    expect(await names(false)).toEqual(["gs1_trade_item", "label_from_zpl"]);
  });

  it("adds the window-bound ones once a window is attached", async () => {
    expect(await names(true)).toContain("edit_open_label");
    expect(await names(true)).toContain("label_with_logo");
  });

  it("fills an argument into the message it hands the agent", async () => {
    const client = await connect(false);
    const got = await client.getPrompt({ name: "gs1_trade_item", arguments: { gtin: "4012345123456" } });
    const first = got.messages[0]?.content;
    expect(first?.type === "text" ? first.text : "").toContain("4012345123456");
  });
});

describe("a stdio server", () => {
  it("does not promise the window tools it never registers", () => {
    for (const tool of ["get_current_design", "edit_design", "open_in_app", "raster_image"]) {
      expect(SERVER_INSTRUCTIONS).not.toContain(tool);
    }
  });
});

describe("a hosted server", () => {
  it("names every window tool in its instructions", async () => {
    const instructions = (await connect(true)).getInstructions() ?? "";
    for (const tool of ["get_current_design", "edit_design", "open_in_app", "raster_image"]) expect(instructions).toContain(tool);
  });

  it("opens the session by reading the screen once and stops asking after that", async () => {
    const instructions = (await connect(true)).getInstructions() ?? "";
    expect(instructions).toContain("Open the session with get_current_design");
    expect(instructions).toContain("bounds rows");
    expect(instructions).toContain("Offer once");
    expect(instructions).toContain("without asking again");
    expect(instructions).toContain("Ask before open_in_app");
  });
});
