import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { ToolError } from "@zplab/headless";

/** Every error on the wire, whichever layer raised it. */
export const toolError = (message: string): ToolError => ({ ok: false, errors: [message] });

const digest = (token: string) => createHash("sha256").update(token).digest();

/** Bearer gate for every route registered after it. Same check as the MCP transport, see packages/mcp-server/src/http.ts. */
export function requireToken(expected: string): MiddlewareHandler {
  const wanted = digest(expected);
  return async (c, next) => {
    const match = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
    const provided = digest(match?.[1]?.trim() ?? "");
    if (!match || !timingSafeEqual(provided, wanted)) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json(toolError("missing or invalid bearer token"), 401);
    }
    await next();
  };
}
