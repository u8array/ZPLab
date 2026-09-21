import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, SERVER_INSTRUCTIONS } from "./server";

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
