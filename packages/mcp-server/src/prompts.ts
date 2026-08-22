// Prepared workflows the client offers by name (a slash command in most
// hosts). They carry call ORDER and the pitfalls of a task; object types, props
// and defaults stay in get_schema, so a prompt never restates the schema.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const user = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

const optional = (describe: string) => z.string().optional().describe(describe);

/** Prompt arguments arrive as strings; anything unreadable falls back rather
 *  than printing one size in millimetres and a different one in dots. */
const mm = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Prompts that drive the window exist wherever the transport can reach one,
 *  like the tools they use; whether one is attached is a runtime question. */
export function registerPrompts(server: McpServer, hosted: boolean): void {
  server.registerPrompt(
    "gs1_trade_item",
    {
      title: "GS1 trade-item label",
      description: "Build a GS1-compliant goods label (GTIN, batch, expiry) from scratch.",
      argsSchema: {
        gtin: optional("GTIN of the item, if known"),
        widthMm: optional("label width in mm (default 100)"),
        heightMm: optional("label height in mm (default 70)"),
      },
    },
    ({ gtin, widthMm, heightMm }) =>
      user(
        `Build a GS1 trade-item label, ${mm(widthMm, 100)}x${mm(heightMm, 70)} mm ` +
          `(at 8 dots/mm that is ${mm(widthMm, 100) * 8}x${mm(heightMm, 70) * 8} dots, ` +
          "which is the unit every position is in)" +
          (gtin ? `, GTIN ${gtin}` : "") +
          ". Carry the AIs in a code128 with gs1: true, written as " +
          "(01)…(10)…(17)…; the emitter inserts the FNC1 separators. Repeat the " +
          "same data as plain text lines, so the label survives a failed scan.",
      ),
  );

  server.registerPrompt(
    "label_from_zpl",
    {
      title: "Take over existing ZPL",
      description: "Turn a ZPL stream into an editable design and change it without a rebuild.",
      argsSchema: { zpl: optional("the ZPL stream, if you already have it") },
    },
    ({ zpl }) =>
      user(
        (zpl ? `Take over this ZPL:\n\n${zpl}\n\n` : "Ask me for the ZPL stream, then ") +
          "call import_zpl and report its findings. Change it with patch_design, " +
          "never by rebuilding it with create_draft, which drops the commands the " +
          "model does not carry. A patched page re-emits normalized: same print, " +
          "different bytes, so do not promise an identical stream.",
      ),
  );

  if (!hosted) return;

  server.registerPrompt(
    "edit_open_label",
    {
      title: "Edit the open label",
      description: "Change the design currently open in ZPLab, in place.",
      argsSchema: { change: optional("what should change") },
    },
    ({ change }) =>
      user(
        `Change the label open in ZPLab${change ? `: ${change}` : ""}. ` +
          "Start with get_current_design, take the object ids from its bounds, " +
          "and apply the smallest patch_design that does it. Wait for my go " +
          "before open_in_app: it replaces what is on my screen.",
      ),
  );

  server.registerPrompt(
    "label_with_logo",
    {
      title: "Place a logo",
      description: "Put an image on a label as a printable 1-bit graphic.",
      argsSchema: { source: optional("URL or path of the image") },
    },
    ({ source }) =>
      user(
        `Place a logo${source ? ` from ${source}` : ""} on the label. Fetch the ` +
          "bytes yourself and hand them to raster_image as a data: URL; the tool " +
          "renders, it does not download. The height follows the aspect ratio, so " +
          "check it against the space you have before placing the returned object.",
      ),
  );
}
