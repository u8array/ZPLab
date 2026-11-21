import { Hono, type MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import { noSuchRoute, type createApp } from "./app.js";

/** `serveStatic` builds its answer before its `onFound` hook runs, so the header goes on after the handler. */
const cacheControl = (value: string): MiddlewareHandler => async (c, next) => {
  await next();
  if (c.res.ok) c.header("Cache-Control", value);
};

/** The desktop policy of src-tauri/tauri.conf.json, with connect-src open for Labelary, Browser Print and a typed printer address. */
const CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "blob:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'", "http:", "https:"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
};

/** The API with the designer build from `dir` added around it, under the cache headers of docker/nginx.conf. */
export function withDesigner(api: ReturnType<typeof createApp>, dir: string): Hono {
  const build = serveStatic({ root: dir });
  // A build carries no dotfile, so a dotfile path skips file serving and falls through to the next handler.
  const files: MiddlewareHandler = (c, next) => (c.req.path.includes("/.") ? next() : build(c, next));
  const root = new Hono();
  root.route("/", api);
  // A mounted app loses its own 404, so the root answers every path the API leaves open.
  root.notFound(noSuchRoute);
  root.all("/api/*", noSuchRoute);
  root.use(compress());
  // The server ends no TLS, so HSTS is up to whoever does, and the default would bind every subdomain of its host.
  root.use(secureHeaders({ contentSecurityPolicy: CSP, strictTransportSecurity: false, xFrameOptions: "DENY" }));
  // Vite content-hashes every file under assets, so an immutable cache is safe.
  root.get("/assets/*", cacheControl("public, max-age=31536000, immutable"), files, noSuchRoute);
  root.get("*", cacheControl("no-cache"), files, serveStatic({ root: dir, path: "index.html" }));
  return root;
}
