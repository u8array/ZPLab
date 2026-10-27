# @zplab/server

A REST server over `@zplab/headless`. It gives callers without an MCP client the same draft, validation, patch, export, import and schema logic as the MCP server.

## Run

```sh
ZPLAB_TOKEN=change-me pnpm --filter @zplab/server start
```

```powershell
$env:ZPLAB_TOKEN = "change-me"; pnpm --filter @zplab/server start
```

| Variable | Default | Meaning |
|---|---|---|
| `ZPLAB_TOKEN` | required | The bearer token every design route expects |
| `ZPLAB_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` exposes the server to the network |
| `ZPLAB_PORT` | `8787` | Port |
| `ZPLAB_VERSION` | `dev` | Reported by `/health` and the OpenAPI document |

## Routes

All under `/api/v1`. `GET /health` and `GET /openapi.json` need no token.

- `POST /draft`: build a design file from a size and a list of objects.
- `POST /validate`: report a design file.
- `POST /patch`: apply update, add, remove and variable operations to a design file.
- `POST /export`: generate the ZPL of a design file, plain or with ZPLab's `^FX` metadata, single or as a batch.
- `POST /import`: parse raw ZPL into a design file.
- `POST /validate-zpl`: report raw ZPL without building a design.
- `GET /schema`: the object types and props a design file takes.

Request bodies match the MCP tools for the same operations. Every refusal has the shape `{ "ok": false, "errors": ["..."] }`, with status 400 for input, 401 for the token, 404 for an unknown route, 413 over 16 MiB, 415 for a content type other than `application/json` and 500 for a server fault.

```
curl -s -H "Authorization: Bearer change-me" -H "Content-Type: application/json" \
  -d '{"zpl":"^XA^FO50,50^A0N,30,30^FDHello^FS^XZ"}' http://127.0.0.1:8787/api/v1/validate-zpl
```
