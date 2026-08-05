# ZPLab

<img src="public/favicon.png" alt="ZPLab logo" width="64" align="right" />

[![Deploy](https://github.com/u8array/ZPLab/actions/workflows/deploy.yml/badge.svg?branch=prod)](https://github.com/u8array/ZPLab/actions/workflows/deploy.yml?query=branch%3Aprod)
[![CI](https://github.com/u8array/ZPLab/actions/workflows/pr.yml/badge.svg)](https://github.com/u8array/ZPLab/actions/workflows/pr.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A browser-based ZPL editor for Zebra printers: design labels visually, or import existing ZPL, edit it, and re-export it byte-for-byte.

Writing ZPL (Zebra Programming Language) by hand is tedious: cryptic commands, dot coordinates, no visual feedback until something comes out of the printer. ZPLab lets you build labels visually instead. Drag elements onto the canvas, tweak them in the properties panel, then copy or download the ZPL. No installation, no ZPL knowledge required.

Existing ZPL files are a first-class source, not a one-way import: a re-exported label stays byte-for-byte identical except for the objects you actually edited (see [Import guarantees](#import-guarantees)); GS1 and EAN/UPC content is validated field by field.

**[Try it](https://zplab.org/)** · [Download the desktop app](#download) · [Report an issue](https://github.com/u8array/ZPLab/issues)

> **Disclaimer:** This is an independent open-source tool, not affiliated with, endorsed by, or associated with Zebra Technologies Corp. Zebra is a trademark of Zebra Technologies Corp.; all other trademarks are the property of their respective owners.

---

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshot-light.png">
  <img alt="ZPLab: designer with a sample label" src="docs/screenshot-light.png">
</picture>

---

## Download

| Platform | [v0.3.2](https://github.com/u8array/ZPLab/releases/tag/v0.3.2) |
|---|---|
| Windows | [x64 installer](https://github.com/u8array/ZPLab/releases/download/v0.3.2/ZPLab_0.3.2_x64-setup.exe) |
| macOS | [Apple Silicon](https://github.com/u8array/ZPLab/releases/download/v0.3.2/ZPLab_0.3.2_aarch64.dmg) · [Intel](https://github.com/u8array/ZPLab/releases/download/v0.3.2/ZPLab_0.3.2_x64.dmg) |
| Linux | [AppImage](https://github.com/u8array/ZPLab/releases/download/v0.3.2/ZPLab_0.3.2_amd64.AppImage) · [deb](https://github.com/u8array/ZPLab/releases/download/v0.3.2/ZPLab_0.3.2_amd64.deb) · [rpm](https://github.com/u8array/ZPLab/releases/download/v0.3.2/ZPLab-0.3.2-1.x86_64.rpm) |
| Web (self-hosted) | [web.zip](https://github.com/u8array/ZPLab/releases/download/v0.3.2/ZPLab_0.3.2_web.zip) |

macOS blocks the first launch; allow the app under *System Settings > Privacy & Security*.

## Usage

### 1. Set up the label

The label dimensions and print resolution are shown in the header (`width × height mm · dpmm`). Deselect everything (click empty canvas) to edit them in the **Properties** panel.

The print resolution (dpmm = dots per millimeter) must match your printer. Common values: 6 dpmm (152 dpi), 8 dpmm (203 dpi), 12 dpmm (300 dpi), 24 dpmm (600 dpi). Check your printer's manual if unsure; 8 dpmm is the most common.

### 2. Add objects

Drag items from the left panel onto the canvas, or double-click them to add at the center.

Available objects: text, serial (auto-incrementing number fields), barcodes (28 symbologies including Code 128, QR, DataMatrix, PDF417, Maxicode), shapes (box, line, ellipse), images, and graphic symbols (®/©/™).

<details>
<summary>Full list of supported barcode symbologies</summary>

**1D linear:** Code 128, Code 39, Code 93, Code 11, Interleaved 2 of 5, Standard 2 of 5, Industrial 2 of 5, Codabar, LOGMARS, MSI, Plessey, GS1 Databar, Planet Code, Postal/POSTNET, EAN-13, EAN-8, UPC-A, UPC-E, UPC/EAN 2- or 5-digit supplement, Code 49

**2D matrix:** QR Code, DataMatrix, PDF417, MicroPDF417, Aztec, Codablock F, Maxicode, TLC39

</details>

### 3. Edit properties

Select an object to configure it in the **Properties** panel on the right: content, size, font, barcode options, etc.

Multiple objects can be selected by holding Shift or drawing a lasso. Position changes apply to all selected objects; resizing works one object at a time.

### 4. Print or export

The **ZPL output** panel at the bottom shows the generated ZPL. It updates in real time as you edit.

- **Copy**: copies the ZPL to the clipboard; paste it into your printer software or send it straight to the printer
- **Preview**: renders a preview image via [Labelary](https://labelary.com/) or, on desktop, the connected printer's own firmware (see Printer settings)
- **Export** (File menu): downloads a `.zpl` file
- **Print** (File menu): opens the Labelary preview and triggers the browser print dialog

### Importing existing ZPL

File menu → **Import ZPL**: paste ZPL code directly, or open a `.zpl` file.

> Import round-trips text, barcodes, shapes, images (including printer-stored and compressed graphics), label-header settings, and template fields (`^FN` slots land in the **Variables** tab; `^FE` inline embeds like `^FD#1#-#2#` import as `«name»` markers in the field content). Anything else the parser doesn't recognize is listed in the import report; it doesn't appear on the canvas, but it survives in the exported ZPL (see below).

### Import guarantees

Edit an imported label and export it again:

- **Preserved:** everything you didn't touch comes back byte-for-byte, including fields, label settings, comments, whitespace, and commands the editor doesn't model. A zero-edit import/export cycle reproduces the file exactly.
- **Regenerated:** only the objects you edit, add, or delete are re-emitted from the model. The rest of the file is spliced back unchanged.
- **Full-regeneration fallback:** a few constructs make per-object patching unsafe: `^MU` unit scaling, non-default `^CC`/`^CT`/`^CD` command prefixes, non-UTF-8 `^CI` encoding, non-default `^FE` embed delimiters, a bare `^FN` declared outside a field, an in-span `^JM` density switch, and a barcode relying on a `^BY` from an earlier field. On such labels the first edit regenerates the whole label; with no edits the export stays byte-for-byte.

Byte capture at import is deliberately conservative: when a field can't be mapped cleanly to a single object, the whole label falls back to model regeneration, which keeps the content but not the exact bytes. The captured bytes are stored in saved `.json` designs; a design from an older app version with an outdated capture format is detected and rebuilt.

### Multiple labels (pages)

File menu → **Add page** creates a new page. With multiple pages, the control at the bottom-center of the canvas switches between them and removes them. All pages share the same dimensions; export and import handle each page as a separate label.

### Batch printing from data

File menu → **Import CSV data** loads a CSV. The mapping dialog pairs each Variable with a column, saved with the design. **Export batch ZPL** or **Send to Zebra Printer** then outputs one label per row.

On desktop, **Import Excel data** reads a worksheet and **Printer settings… → Data sources** pulls from a read-only SQLite/PostgreSQL/MySQL database (password in the OS keychain), through the same mapping and batch output. A design remembers its database link for one-click reload.

### Printer settings

File menu → **Printer settings…** configures label-level media and print quality, plus a Setup Script for clock, locale, encoding, and printer identity (meant to be sent once when first setting up a printer). Setup-Script values stay out of saved designs so sharing a `.zpl` or `.json` doesn't leak your printer name or locale.

Its **Preview** tab chooses which renderer draws the overlay (Labelary's online service, or on desktop the connected printer's own firmware) and holds an optional premium Labelary endpoint and API key; the key is stored in the OS keychain on desktop, in browser storage on the web.

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
| Arrow keys / `Shift`+Arrow | Nudge selection (snap step / 10 mm) |
| `G` | Toggle grid |
| `S` | Toggle snap |
| `R` | Rotate view (0° → 90° → 180° → 270°) |
| `Page Up` / `Page Down` | Previous / Next page |
| `Alt/⌥`+click | Cycle selection through stacked objects (select-below) |
| Middle mouse / Space+drag | Pan canvas |
| Scroll | Pan canvas |
| `Ctrl/⌘`+Scroll | Zoom |

### Saving and loading

Both `.zpl` and `.json` round-trip cleanly. `.zpl` preserves all printable content and works as a design source: re-import it and keep editing. `.json` (File → Save Design) additionally stores designer-only state that has no ZPL representation: locked/hidden objects, items excluded from export, custom object names, and group structure.

---

## Features

- Smart alignment and spacing guides
- Layers panel with reordering
- Lossless ZPL round-trip: imported ZPL re-exports byte-for-byte, regenerating only what you edit ([import guarantees](#import-guarantees))
- Variables: bind text and barcode fields to named defaults that emit as `^FN` slots (or `^FE` inline embeds when one field references multiple variables), round-tripping with printer-side templates
- Batch printing: map columns to Variables from a CSV, an Excel worksheet, or a read-only database (desktop), then print or export with efficient printer-side data merge (template ships once, each row sends only its overrides)
- GS1 content builder: assemble GS1 content from Application Identifiers (DataBar Expanded, GS1-128, and GS1 DataMatrix), validated per field and against GS1 combination rules
- Content builder: generate typed QR/DataMatrix/Aztec content (URL, WiFi, contact, email, phone, SMS, geo) with the right encoding and escaping
- EAN/UPC inline validation: live length counter, computed check-digit preview, and a GS1 prefix hint right under the content field
- Printer settings: label-level hardware tuning plus a Setup Script for clock, locale, encoding, and printer identity
- 32 UI languages (auto-detected from browser)
- Light / dark mode (follows OS setting)

---

## Coverage

<!-- coverage:start (generated from docs/zpl-roadmap.md by scripts/gen-coverage.mjs; run `pnpm coverage:gen`) -->
114 of the 225 ZPL II commands tracked in the [roadmap](docs/zpl-roadmap.md) are supported today. Categorical breakdown:

| Area | Supported |
|---|---|
| Layout & flow | 16 / 16 |
| Templates & variables | 4 / 4 |
| Barcodes | 28 / 28 |
| Fields | 18 / 20 |
| Serialisation | 2 / 2 |
| Encoding & language | 3 / 3 |
| Clock & time | 3 / 3 |
| Identity & access | 3 / 3 |
| Graphics | 6 / 12 |
| Media & feed | 10 / 10 |
| Text & fonts | 7 / 14 |
| Print quality | 10 / 18 |
| Configuration & persistence | 3 / 5 |
| Hardware / Host comm / RFID / Network | 1 / 87 |
<!-- coverage:end -->

---

## Limitations

- The canvas is a design preview, not a pixel-perfect simulation. Shapes, spacing, and positions match the print; text approximates Zebra's built-in font to within a few dots, but exact letterforms and anti-aliasing differ. For a faithful render, use the **Preview** in the bottom-right panel (Labelary, or on desktop the printer's own firmware).
- The default preview renderer is Labelary; the web build calls `api.labelary.com`, and self-hosters can point at a private endpoint or turn it off (a premium endpoint and key can also be set at runtime, see Printer settings). The desktop app can preview on the connected printer instead.
- The Labelary preview doesn't render every ZPL feature. Some less common elements (e.g. Codablock F, Maxicode) may be missing or wrong in the preview even when the actual print is fine.
- The preview shows only the current page (either renderer); the printed/exported ZPL still contains every page.

---

## Development

```bash
pnpm install
pnpm dev
```

Requires Node.js ≥ 24 and pnpm. Alternatively use `npm install` / `npm run dev`.

```bash
pnpm build   # output goes to dist/
```

The web build output is entirely static and can be served from any web server or file host. The desktop app is a separate [Tauri](https://tauri.app/) shell (`src-tauri/`) with native printer I/O.

### Tech stack

- [React 19](https://react.dev/) + TypeScript
- [Vite](https://vite.dev/)
- [Konva](https://konvajs.org/) / react-konva: canvas rendering
- [Zustand](https://github.com/pmndrs/zustand) + [zundo](https://github.com/charkour/zundo): state and undo history
- [bwip-js](https://github.com/metafloor/bwip-js): barcode rendering
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Tauri](https://tauri.app/): desktop shell (native printing and file dialogs)

### How it works

The editor stores the label as a list of objects in Zustand. On every change, ZPL II is generated client-side by mapping each object to its corresponding ZPL commands. Barcodes are rendered on the canvas using bwip-js. Preview images come from the Labelary API or, on desktop, the connected printer's firmware.

---

## Contributing

Issues and pull requests are welcome.

If you find a ZPL file that imports incorrectly, attaching the `.zpl` file to the issue is the most useful thing you can do.

---

## License

MIT
