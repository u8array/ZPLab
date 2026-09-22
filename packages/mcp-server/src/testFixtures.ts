/** Shared design-file fixtures for the tool and HTTP transport tests. */

import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function connect(server: McpServer): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

/** The sidecar writes its app requests to stdout. The spy stands in for the app reading them. */
export function spyStdout(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  return { writes, restore: () => spy.mockRestore() };
}

export function textObject(id: string, content: string) {
  return {
    id,
    type: "text",
    x: 10,
    y: 10,
    rotation: 0,
    props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" },
  };
}

/** A label the way a model hand-builds it: bytes a JSON round-trip must carry unchanged. */
export const demoLabel = {
  schemaVersion: 6,
  label: { widthMm: 100, heightMm: 60, dpmm: 8 },
  variables: [
    { name: "bezeichnung", defaultValue: "Bio-Müsli • Früchte" },
    { name: "preis", defaultValue: "4,99 €" },
  ],
  pages: [
    {
      objects: [
        textObject("titel", "«bezeichnung»"),
        { ...textObject("preis", "Preis: «preis»"), y: 60 },
        { ...textObject("hinweis", "• Ohne Zusätze • Äpfel aus der Region"), y: 110 },
        { id: "ean", type: "ean13", x: 10, y: 200, rotation: 0, props: { content: "400638133393", height: 80 } },
      ],
    },
    { objects: [textObject("rueck", "Rückseite: Zutaten • Nährwerte")] },
  ],
};

/** Minimal valid single-page design file. */
export const designFile = {
  schemaVersion: 3,
  label: { widthMm: 100, heightMm: 50, dpmm: 8 },
  pages: [{ objects: [textObject("t1", "HELLO")] }],
};
