# @zplab/mcp-server

An MCP server that lets an assistant build ZPLab label drafts and turn them into ZPL.

## Tools

- `get_schema`: list the supported object types and their props.
- `create_draft`: build a design file from a size and a list of objects, with preflight warnings, per-object bounds, and bbox overlaps.
- `validate_draft`: parse a design file and return schema errors, preflight warnings, per-object bounds, and bbox overlaps.
- `export_zpl`: parse a design file and return its generated ZPL.
- `validate_zpl`: parse raw ZPL (one page per `^XA` block) and report object/page count, detected label, parser findings, preflight warnings, per-object bounds, and bbox overlaps.
- `import_zpl`: parse raw ZPL into an editable design file (one page per `^XA` block, overlays preserved for verbatim re-export) plus parser findings, per-object bounds, and bbox overlaps.
- `patch_design`: apply update, add, remove and variable-edit operations to a design file without rebuilding it.
- `open_in_app`: push a design file into the running ZPLab desktop app. Only registered when the app spawned the server (HTTP mode), so it is absent over stdio.
- `get_current_design`: read back the design currently open in the desktop app, with render-measured bounds (nothing `approx`). App-spawned HTTP mode only.
- `edit_design`: apply the operations `patch_design` takes to the design open in the desktop app. The app edits in place and the whole call is one undo step. App-spawned HTTP mode only.
- `raster_image`: turn a data URL image into a placeable 1-bit graphic object. App-spawned HTTP mode only.

Bounds are dots (visual top-left); `approx` marks headless estimates (barcode
footprints and single-line text), not render-measured. Overlaps are raw bbox
intersections, not errors: a frame/reverse box overlaps its contents by design.
Geometry is bounded on hostile input: a page past 2000 objects skips its
geometry and overlaps are capped, both flagged by `geometryTruncated`. Raw ZPL
over 256 KB is rejected (`ok: false`).

## Run

```
pnpm --filter @zplab/mcp-server exec tsx src/index.ts
```

Default transport is stdio. Passing `--http` serves the Streamable HTTP transport
instead, bound to `127.0.0.1` only:

```
pnpm --filter @zplab/mcp-server exec tsx src/index.ts --http --port 4923 --token <token>
```

`--port` and `--token` are both required with `--http`. Every request must carry
`Authorization: Bearer <token>`; loopback-only binding plus Origin/Host checks
guard against local drive-by and DNS-rebinding.

## MCP client config

Most MCP clients (Claude Desktop and others) accept this `mcpServers` shape:

```json
{
  "mcpServers": {
    "zplab": {
      "command": "pnpm",
      "args": ["--filter", "@zplab/mcp-server", "exec", "tsx", "src/index.ts"],
      "cwd": "/path/to/zpl_label_designer"
    }
  }
}
```
