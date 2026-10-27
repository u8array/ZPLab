# ZPLab server

A REST server over ZPLab's draft, validate, import, export and patch logic, for scripts and integrations. The server has no designer, no printing and no storage.

## Run

```sh
ZPLAB_TOKEN=change-me ./zplab-server
```

```powershell
$env:ZPLAB_TOKEN = "change-me"; .\zplab-server.exe
```

| Variable | Default | Meaning |
|---|---|---|
| `ZPLAB_TOKEN` | required | The bearer token every design route expects |
| `ZPLAB_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` serves the network |
| `ZPLAB_PORT` | `8787` | Port |

The token travels in plain text. Serve the network only behind a reverse proxy with TLS.

The macOS binary is not notarized. Clear the download flag once with `xattr -dr com.apple.quarantine zplab-server`.

On Windows, SmartScreen warns when you first run the unsigned binary. Choose **More info**, then **Run anyway**.

## Routes

All routes sit under `/api/v1`. `GET /health` and `GET /openapi.json` need no token. The OpenAPI document describes the rest: `POST /draft`, `/validate`, `/patch`, `/export`, `/import`, `/validate-zpl` and `GET /schema`.

```sh
curl -s -H "Authorization: Bearer change-me" -H "Content-Type: application/json" \
  -d '{"zpl":"^XA^FO50,50^A0N,30,30^FDHello^FS^XZ"}' http://127.0.0.1:8787/api/v1/validate-zpl
```

The same server is published as a container image, `ghcr.io/u8array/zplab-server`. Third-party notices are in `THIRD-PARTY-LICENSES.md`. The binary embeds Node.js, whose license is in `NODE-LICENSE`.
