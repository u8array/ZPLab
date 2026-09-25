# ZPLab

<img src="public/favicon.png" alt="ZPLab logo" width="64" align="right" />

[![Deploy](https://github.com/u8array/ZPLab/actions/workflows/deploy.yml/badge.svg?branch=prod)](https://github.com/u8array/ZPLab/actions/workflows/deploy.yml?query=branch%3Aprod)
[![CI](https://github.com/u8array/ZPLab/actions/workflows/pr.yml/badge.svg)](https://github.com/u8array/ZPLab/actions/workflows/pr.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

ZPLab is a visual label designer and ZPL editor for ZPL-compatible printers, available in the browser or as a desktop app.

Drag objects onto the canvas, edit their properties, then copy or export the ZPL. Imported ZPL stays editable source.

**[Try it](https://app.zplab.org/)** · [Download](#download) · [Getting started](#getting-started) · [Working with ZPL](#working-with-zpl) · [Self-hosting](#self-hosting) · [Report an issue](https://github.com/u8array/ZPLab/issues)

> **Disclaimer:** This is an independent open-source tool, not affiliated with, endorsed by or associated with Zebra Technologies Corp. Zebra is a trademark of Zebra Technologies Corp. All other trademarks belong to their owners.

---

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshot-light.png">
  <img alt="ZPLab with a release label on the canvas, the object palette on the left and the Properties tab on the right" src="docs/screenshot-light.png">
</picture>

---

## Features

- Visual canvas with layers, alignment guides, text, serial counters, 28 barcode symbologies, shapes, images and graphic symbols
- Editable ZPL source and a reference for every ZPL II command
- Variables, CSV, Excel and database batches
- GS1 and EAN/UPC content builders with validation
- Content builder for QR, Data Matrix and Aztec: URLs, Wi-Fi, contacts, email, phone, SMS and coordinates, plus GS1 Digital Links on QR and Data Matrix
- 32 interface languages, light and dark theme
- MCP server on desktop for a local AI assistant

## Download

| Platform | [v0.6.0](https://github.com/u8array/ZPLab/releases/tag/v0.6.0) |
|---|---|
| Windows | [x64 installer](https://github.com/u8array/ZPLab/releases/download/v0.6.0/ZPLab_0.6.0_x64-setup.exe) |
| macOS | [Apple Silicon](https://github.com/u8array/ZPLab/releases/download/v0.6.0/ZPLab_0.6.0_aarch64.dmg) · [Intel](https://github.com/u8array/ZPLab/releases/download/v0.6.0/ZPLab_0.6.0_x64.dmg) |
| Linux | [AppImage](https://github.com/u8array/ZPLab/releases/download/v0.6.0/ZPLab_0.6.0_amd64.AppImage) · [deb](https://github.com/u8array/ZPLab/releases/download/v0.6.0/ZPLab_0.6.0_amd64.deb) · [rpm](https://github.com/u8array/ZPLab/releases/download/v0.6.0/ZPLab-0.6.0-1.x86_64.rpm) |
| Web (self-hosted) | [zip](https://github.com/u8array/ZPLab/releases/download/v0.6.0/ZPLab_0.6.0_web.zip) · [Docker](#self-hosting) |

On macOS, the first launch may be blocked. Allow ZPLab under **System Settings → Privacy & Security**.

On Windows, SmartScreen warns when you first run the unsigned installer. Choose **More info**, then **Run anyway**.

## Getting started

### 1. Set up the label

Click the empty canvas to deselect everything, then set the label size and print resolution in the **Properties** tab. The web app also shows them in the header.

Match the print resolution to your printer, 8 dpmm on most models: 6 dpmm (152 dpi), 8 dpmm (203 dpi), 12 dpmm (300 dpi) or 24 dpmm (600 dpi).

### 2. Add objects

Drag items from the object palette onto the canvas, or double-click an item to add it at the centre.

<details>
<summary>Barcodes in the palette</summary>

**1D Linear:** Code 128, GS1-128, Code 39, Code 93, EAN-13, EAN-8, UPC-A, UPC-E, UPC/EAN extension, GS1 Databar, Interleaved 2 of 5

**2D Matrix:** QR Code, Data Matrix, GS1 DataMatrix, PDF417, MicroPDF417, Aztec, Maxicode, CODABLOCK

**Legacy:** Codabar, Code 11, Code 49, Industrial 2 of 5, Standard 2 of 5, LOGMARS, MSI, Plessey, Planet Code, POSTNET, TLC39

</details>

### 3. Edit properties

Select an object to edit its content, size, font and barcode options in the **Properties** tab.

Select several objects with Shift-click or a lasso. Position and size changes apply to every selected object. A locked object blocks resizing for the selection.

### 4. Print or export

The **ZPL** panel at the bottom shows the generated ZPL, **Copy** puts it on the clipboard. The canvas is an approximation. **Preview** renders the label through [Labelary](https://labelary.com/) or, on desktop, the connected printer.

- **File → Export ZPL:** saves a `.zpl` file, or `.prn` where the save dialog offers file types
- **File → Send to Zebra Printer:** opens the send dialog. It sends over the network, through the Zebra Browser Print agent in the browser, or through the system spooler or USB on desktop.
- **File → Print as Image (browser):** opens the Labelary preview, then the browser print dialog

### 5. Save the design

**File → Save design** writes a `.json` file with the imported source and the editor settings, that is groups, object names, lock and visibility, export exclusions and variable bindings.

## Working with ZPL

### Editing the ZPL source

The **ZPL** panel highlights syntax and collapses long blocks of image data. Selecting a canvas object marks its ZPL lines. A notice above the code lists commands that change saved printer settings or control the printer.

The **ZPL reference** beside the code follows the cursor. Search to filter the list, or click a command to pin its details. **Insert** adds the command at the cursor, or before the current page's `^XZ` when the cursor is not in the code.

While you edit, the canvas shows a live preview. Canvas editing and the **Properties** tab are disabled. Page switching stays enabled. The editor refuses source that is too large or has mismatched `^XA`/`^XZ` commands, and marks the mismatches.

- **Apply** or leaving the panel commits your changes.
- `Esc` or **Cancel** discards them.
- ZPLab asks for confirmation when parsing finds problems, when editor settings would be lost, or when fonts or graphics move into the printer profile. It also asks when you discard a changed source.
- Applying re-imports the ZPL under the [Import guarantees](#import-guarantees).

### Importing existing ZPL

**File → Import ZPL** takes pasted ZPL, a `.zpl` file or a `.prn` file.

Import covers text, barcodes, shapes, label settings and `^FN` fields. Images include printer-stored and compressed graphics. `^FN` slots appear in the **Variables** tab. `^FE` embeds such as `^FD#1#-#2#` import as `«name»` markers.

- Unrecognised commands are listed in the import report and do not appear on the canvas.
- Commands between fields survive export.
- Commands inside a field survive until you edit that object.
- Whole-page regeneration drops every unrecognised command on that page.

### Import guarantees

Export reuses the original source where possible:

- **Unchanged source:** where ZPLab keeps the source, importing and exporting without edits reproduces it byte-for-byte, including fields, label settings, comments, whitespace and unsupported commands.
- **Object edits:** ZPLab generates ZPL for added and changed objects and removes deleted ones. Changing a label setting regenerates every page when it changes the emitted ZPL. So does changing a variable's `^FN` slot number or default value. Renaming a variable does not.
- **Whole-page regeneration:** some commands affect other fields or must be rewritten on export. The first object edit then regenerates the page. See [the triggers](docs/regeneration-triggers.md).

When the parser cannot match source fields to objects, export regenerates the page from the imported objects and settings. Formatting can change and unsupported commands are dropped. A source saved in an older, incompatible format falls back the same way.

### Variables

The **Variables** tab adds a variable with a name, an `^FN` slot and a default value. Bind it from a field's **Edit content** dialog in the **Properties** tab, opened by the `{x}` button beside the content field. A field holding one variable exports as `^FN`, a variable inside other content as `^FE`.

### Fonts

The **Fonts** tab uploads TrueType fonts and assigns their `^CW` alias.

### Pages

**File → Add page** creates another page. The page controls below the canvas switch and remove pages. All pages share one size. Export and import treat each page as a separate label.

### Batch printing

**File → Import CSV data** (web) or **File → Connect data** (desktop) loads a CSV. Assign a column to each variable in the mapping dialog. **File → Export batch ZPL** or **File → Send to Zebra Printer** then produce one label per row. Export names the row count, the send item names the labels the printer will produce.

The batch stores the page as a format on the printer and recalls it per row. A page that names a stored format keeps that name when the name itself is at most 8 characters. Longer names fall back to `R:LBL.ZPL`.

On desktop, **Connect data** also reads an Excel worksheet. **File → Settings… → App → Database connection** loads rows from a read-only SQLite, PostgreSQL or MySQL database, with the password in the OS keychain. The design saves the assignments and the connection.

### Printer settings

**File → Settings… → Per Label** configures media, print quality, output and RFID. The **Setup Script** covers clock, encoding, fonts, printer identity and maintenance.

- The **Objects** group selects the fonts and graphics the **Setup Script** uploads.
- It lists cached images and deletes the unused ones.
- Saved designs and label exports exclude **Setup Script** values such as printer name and locale.
- **Clear** resets the **Setup Script** values and keeps the uploads.

The **App → Preview** tab selects the renderer and takes a premium Labelary endpoint and API key. The key is stored in the OS keychain on desktop and in browser storage on the web.

### MCP server

On desktop, **File → Settings… → App → MCP** starts a local MCP server, so an AI assistant can read and edit the open label.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/⌘+Z` / `Ctrl/⌘+Shift+Z` | Undo / Redo |
| `Ctrl/⌘+A` | Select all |
| `Ctrl/⌘+C` / `Ctrl/⌘+V` | Copy / Paste |
| `Ctrl/⌘+D` | Duplicate selection |
| `Ctrl/⌘+G` / `Ctrl/⌘+Shift+G` | Group / Ungroup selection |
| `Ctrl/⌘+L` / `Ctrl/⌘+Shift+L` | Lock / Unlock selection |
| `Del` / `Backspace` | Delete selection |
| Arrow keys | Move by the snap step, 1 dot with snap off |
| `Shift`+Arrow | Move by 10 mm |
| `G` | Toggle grid |
| `S` | Toggle snap |
| `R` | Rotate the view by 90° |
| `Page Up` / `Page Down` | Previous / Next page |
| `Alt/⌥`+click | Cycle selection through stacked objects |
| Scroll, middle mouse or `Space`+drag | Pan canvas |
| `Ctrl/⌘`+Scroll | Zoom |
| `↑` / `↓` in the ZPL reference | Move through the list |
| `Enter` in the ZPL reference | Insert the highlighted command |
| `Esc` in the ZPL reference | Follow the cursor again |

## Coverage

<!-- coverage:start (generated from the command catalog by scripts/gen-coverage.mjs; run `pnpm coverage:gen`) -->
119 of the 225 ZPL II commands are modelled in the browser; desktop covers 2 more with a connected printer. 3 more are planned for both builds. 79 need a connected printer and are planned for desktop. The source editor checks parameters for 1 command. See per-command coverage: [docs/zpl-coverage.md](docs/zpl-coverage.md).

| Area | Modelled |
|---|---|
| Layout & flow | 15 / 15 |
| Templates & variables | 2 / 3 |
| Barcodes | 29 / 29 |
| Fields | 16 / 17 |
| Serialisation | 2 / 2 |
| Encoding & language | 3 / 3 |
| Clock & time | 4 / 4 |
| Identity & access | 2 / 2 |
| Graphics | 10 / 14 |
| Media & feed | 9 / 9 |
| Text & fonts | 9 / 15 |
| Print quality | 10 / 18 |
| Configuration & persistence | 4 / 5 |
| Hardware / Host comm / RFID / Network | 4 / 89 |
<!-- coverage:end -->

## Limitations

- Labelary ignores CODABLOCK's `^BB` and shows the field content as plain text. It renders Maxicode slightly smaller than a Zebra ZD230.
- **Preview** and **Print as Image (browser)** render only the current page. **Export ZPL** and **Send to Zebra Printer** include every page.
- A page with a stored format (`^DF`) is stored on the printer instead of printed. **Send to Zebra Printer** says so before sending.
- The GS1 builders skip the multi-part identifiers GDTI (253), GCN (255), GRAI (8003) and ITIP (8006), as barcode data and as Digital Link keys.

## Self-hosting

Extract the web release zip and serve its contents from your web server's root, not a subdirectory, or run the container:

```sh
docker run -p 8080:8080 ghcr.io/u8array/zplab:latest
```

Then open `http://localhost:8080`. The image is published with each release from v0.7.0. To build it yourself:

```sh
docker build -t zplab .
```

- The container serves static files only. Printing and previews run in the browser. Server-side features are planned but not scheduled.
- Outbound calls go to `api.labelary.com` for previews and to the printer or Zebra Browser Print agent a user configures.
- `VITE_THIRD_PARTY_LABELARY=false` switches Labelary previews off for every user of that build. `VITE_LABELARY_API_URL` only sets the default endpoint, which a user can still change in Settings.
- Both are read at build time. Rebuild the image to change them, see the [build options](docs/development.md#build-options).
- A premium Labelary key entered in the web app is stored in that browser.

## Development

```sh
pnpm install
pnpm dev
pnpm build   # output goes to dist/
```

Requires Node.js ≥ 24 and pnpm. The desktop app prints over raw TCP or the system spooler, and over USB on Linux and macOS. Stack, architecture and build options: [docs/development.md](docs/development.md).

## Contributing

Issues and pull requests are welcome. If a ZPL file imports incorrectly, attach it to the issue and describe the expected result.

## License

MIT, see [LICENSE](LICENSE).
