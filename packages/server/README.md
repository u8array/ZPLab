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
| `ZPLAB_TOKEN` | required | The bearer token every design and printer route expects |
| `ZPLAB_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` serves the network |
| `ZPLAB_PORT` | `8787` | Port |
| `ZPLAB_PRINTERS` | none | The printers the server may reach, as a JSON list. See [Printers](#printers) |
| `ZPLAB_DESIGNER_DIR` | none | A designer build to serve at `/`. See [Designer](#designer) |
| `ZPLAB_VERSION` | `dev` | Reported by `/health` and the OpenAPI document. The release binaries and the image carry their version and ignore it |

The token travels in plain text. Serve the network only behind a reverse proxy with TLS.

## Routes

All under `/api/v1`. `GET /health` and `GET /openapi.json` need no token.

- `POST /draft`: build a design file from a size and a list of objects.
- `POST /validate`: report a design file.
- `POST /patch`: apply update, add, remove and variable operations to a design file.
- `POST /export`: generate the ZPL of a design file, plain or with ZPLab's `^FX` metadata, single or as a batch.
- `POST /import`: parse raw ZPL into a design file.
- `POST /validate-zpl`: report raw ZPL without building a design.
- `GET /schema`: the object types and props a design file takes.

Request bodies match the MCP tools for the same operations. Every refusal has the shape `{ "ok": false, "errors": ["..."] }`, with status 400 for input, 401 for the token, 404 for an unknown route or printer, 413 over 16 MiB, 415 for a content type other than `application/json` and 500 for a server fault.

```
curl -s -H "Authorization: Bearer change-me" -H "Content-Type: application/json" \
  -d '{"zpl":"^XA^FO50,50^A0N,30,30^FDHello^FS^XZ"}' http://127.0.0.1:8787/api/v1/validate-zpl
```

## Printers

List the printers the server may reach in `ZPLAB_PRINTERS`.

```sh
ZPLAB_PRINTERS='[{"id":"dock","name":"Dock 3","host":"10.0.0.5"},{"id":"lab","host":"zd230.lan","port":6101}]'
```

The `name` defaults to the id and the `port` to 9100.

- `GET /printers`: the printers by id and name.
- `POST /printers/{id}/send`: send ZPL without waiting for a reply.
- `POST /printers/{id}/query`: send ZPL and stream the reply as JSON lines until the printer closes or `deadlineMs` passes.

```
curl -sN -H "Authorization: Bearer change-me" -H "Content-Type: application/json" \
  -d '{"zpl":"~HS","deadlineMs":3000}' http://127.0.0.1:8787/api/v1/printers/dock/query
```

Whoever holds the token can send any ZPL to every listed printer.

## Designer

The image serves the designer at `/`. That designer prints through the server and reads the printer's reply. Choose **ZPL printer (server)** under **File → Settings… → App → Printer** and enter the token there.

From a checkout, build the designer for the server and name its directory:

```sh
VITE_SERVER_API_URL=/api/v1 pnpm exec vite build
ZPLAB_DESIGNER_DIR="$PWD/dist" ZPLAB_TOKEN=change-me pnpm --filter @zplab/server start
```

```powershell
$env:VITE_SERVER_API_URL = "/api/v1"; pnpm exec vite build
$env:ZPLAB_DESIGNER_DIR = "$PWD\dist"; $env:ZPLAB_TOKEN = "change-me"; pnpm --filter @zplab/server start
```

Behind a reverse proxy, do not buffer the answer of `POST /printers/{id}/query`. The route sets `X-Accel-Buffering: no`, which nginx follows. Other proxies need their own setting.

The server sends the designer with a content security policy. The policy carries `frame-ancestors 'none'`, and the server sets `X-Frame-Options: DENY`. Set `Strict-Transport-Security` on the proxy that ends TLS.
