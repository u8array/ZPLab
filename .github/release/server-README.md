# ZPLab server

A REST server over ZPLab's draft, validate, import, export and patch logic, for scripts and integrations. It also sends ZPL to the printers from `ZPLAB_PRINTERS` and reads their replies. The server has no storage.

## Run

```sh
ZPLAB_TOKEN=change-me ./zplab-server
```

```powershell
$env:ZPLAB_TOKEN = "change-me"; .\zplab-server.exe
```

| Variable | Default | Meaning |
|---|---|---|
| `ZPLAB_TOKEN` | required | The bearer token every design and printer route expects |
| `ZPLAB_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` serves the network |
| `ZPLAB_PORT` | `8787` | Port |
| `ZPLAB_PRINTERS` | none | The printers the server may reach, as a JSON list. See [Printers](#printers) |

The token travels in plain text. Serve the network only behind a reverse proxy with TLS.

The macOS binary is not notarized. Clear the download flag once with `xattr -dr com.apple.quarantine zplab-server`.

On Windows, SmartScreen warns when you first run the unsigned binary. Choose **More info**, then **Run anyway**.

## Printers

```sh
ZPLAB_PRINTERS='[{"id":"dock","name":"Dock 3","host":"10.0.0.5"},{"id":"lab","host":"zd230.lan","port":6101}]'
```

The `name` defaults to the id and the `port` to 9100.

Whoever holds the token can send any ZPL to every listed printer.

## Routes

All routes sit under `/api/v1`. `GET /health` and `GET /openapi.json` need no token. The OpenAPI document describes the rest: `POST /draft`, `/validate`, `/patch`, `/export`, `/import`, `/validate-zpl`, `/printers/{id}/send` and `/printers/{id}/query`, `GET /schema` and `GET /printers`.

```sh
curl -s -H "Authorization: Bearer change-me" -H "Content-Type: application/json" \
  -d '{"zpl":"^XA^FO50,50^A0N,30,30^FDHello^FS^XZ"}' http://127.0.0.1:8787/api/v1/validate-zpl
```

The same server is published as a container image, `ghcr.io/u8array/zplab-server`, which also serves the designer. Third-party notices are in `THIRD-PARTY-LICENSES.md`. The binary embeds Node.js, whose license is in `NODE-LICENSE`.
