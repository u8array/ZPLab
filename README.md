# ZPLab

<img src="public/favicon.png" alt="ZPLab logo" width="64" align="right" />

[![Deploy](https://github.com/u8array/ZPLab/actions/workflows/deploy.yml/badge.svg?branch=prod)](https://github.com/u8array/ZPLab/actions/workflows/deploy.yml?query=branch%3Aprod)
[![CI](https://github.com/u8array/ZPLab/actions/workflows/pr.yml/badge.svg)](https://github.com/u8array/ZPLab/actions/workflows/pr.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A browser-based ZPL editor for Zebra printers. Design labels visually, import existing ZPL, edit it, and export it again without changing untouched bytes.

Hand-written ZPL (Zebra Programming Language) is tedious: cryptic commands, dot coordinates, and no useful visual feedback until the printer runs. ZPLab lets you build labels visually. Drag elements onto the canvas, edit them in the properties panel, then copy or download the ZPL. No installation or ZPL knowledge required.

Existing ZPL files remain editable source, not one-way imports: export preserves untouched bytes and regenerates only edited objects (see [Import guarantees](#import-guarantees)). GS1 and EAN/UPC content is validated field by field.

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

| Platform | [v0.5.0](https://github.com/u8array/ZPLab/releases/tag/v0.5.0) |
|---|---|
| Windows | [x64 installer](https://github.com/u8array/ZPLab/releases/download/v0.5.0/ZPLab_0.5.0_x64-setup.exe) |
| macOS | [Apple Silicon](https://github.com/u8array/ZPLab/releases/download/v0.5.0/ZPLab_0.5.0_aarch64.dmg) · [Intel](https://github.com/u8array/ZPLab/releases/download/v0.5.0/ZPLab_0.5.0_x64.dmg) |
| Linux | [AppImage](https://github.com/u8array/ZPLab/releases/download/v0.5.0/ZPLab_0.5.0_amd64.AppImage) · [deb](https://github.com/u8array/ZPLab/releases/download/v0.5.0/ZPLab_0.5.0_amd64.deb) · [rpm](https://github.com/u8array/ZPLab/releases/download/v0.5.0/ZPLab-0.5.0-1.x86_64.rpm) |
| Web (self-hosted) | [zip](https://github.com/u8array/ZPLab/releases/download/v0.5.0/ZPLab_0.5.0_web.zip) |

On macOS, the first launch may be blocked. Allow ZPLab under *System Settings > Privacy & Security*.

## Usage

### 1. Set up the label

Label dimensions and print resolution are shown in the header (`width × height mm · dpmm`). Deselect everything by clicking the empty canvas, then edit them in the **Properties** panel.

Set the print resolution (dpmm = dots per millimeter) to match your printer. Common values are 6 dpmm (152 dpi), 8 dpmm (203 dpi), 12 dpmm (300 dpi) and 24 dpmm (600 dpi). Check your printer's manual if unsure; 8 dpmm is the most common.

### 2. Add objects

Drag items from the left panel onto the canvas, or double-click an item to add it centered.

Objects include text, serial counters, barcodes (28 symbologies including Code 128, QR, Data Matrix, PDF417 and MaxiCode), shapes (box, line, ellipse), images and graphic symbols (®/©/™).

<details>
<summary>Full list of supported barcode symbologies</summary>

**1D linear:** Code 128, Code 39, Code 93, Code 11, Interleaved 2 of 5, Standard 2 of 5, Industrial 2 of 5, Codabar, LOGMARS, MSI, Plessey, GS1 DataBar, Planet Code, Postal/POSTNET, EAN-13, EAN-8, UPC-A, UPC-E, UPC/EAN 2- or 5-digit add-on, Code 49

**2D matrix:** QR Code, Data Matrix, PDF417, MicroPDF417, Aztec, CODABLOCK F, MaxiCode, TLC39

</details>

### 3. Edit properties

Select an object to configure its content, size, font and barcode options in the **Properties** panel on the right.

Select multiple objects with Shift-click or by drawing a lasso. Position changes apply to all selected objects; resizing works one object at a time.

### 4. Print or export

The **ZPL output** panel at the bottom shows the generated ZPL. It updates in real time, and the code itself is editable.

- **Copy:** copies the ZPL to the clipboard for printer software or direct printer output
- **Preview:** renders an image via [Labelary](https://labelary.com/) or, on desktop, the connected printer's own firmware (see [Printer settings](#printer-settings))
- **Export** (File menu): downloads a `.zpl` file
- **Print** (File menu): opens the Labelary preview and then the browser print dialog

### Editing the ZPL source

The panel is a code editor with ZPL syntax highlighting; long graphic payloads are folded. Selecting a canvas object highlights its generated ZPL lines. A notice above the code flags setup commands that persist on the printer and commands that act on the device.

The command reference beside the code follows the caret. Search filters the list, clicking a row pins it, and **Insert** adds the command at the caret or before the current page's `^XZ` when no caret is active.

The first edit starts an edit session: the canvas and **Properties** panel lock, page navigation stays available, and the canvas previews the parsed source live. Invalid source (unbalanced `^XA`/`^XZ`, too large) shows a reason and is not applied; imbalances are marked at the command that caused them.

Leaving the panel applies the edit. A dialog asks first if reparsing reports findings or would drop designer-only state (groups, names, locked/hidden, export exclusions, variable bindings). `Esc` discards the edit; if the source changed, ZPLab asks for confirmation. Applied source edits count as a new import, so [Import guarantees](#import-guarantees) apply to the result.

### Importing existing ZPL

Use File menu → **Import ZPL** to paste ZPL code directly or open a `.zpl` file.

Import handles text, barcodes, shapes, images (including printer-stored and compressed graphics), label-header settings and template fields. `^FN` slots appear in the **Variables** tab; `^FE` inline embeds such as `^FD#1#-#2#` import as `«name»` markers in the field content.

Commands the parser does not recognize are listed in the import report. They do not appear on the canvas, but they are preserved in exported ZPL.

### Import guarantees

Edit an imported label and export it again:

- **Preserved:** everything you do not touch is exported byte-for-byte, including fields, label settings, comments, whitespace and commands the editor does not model. A zero-edit import/export cycle reproduces the file exactly.
- **Regenerated:** edited, added and deleted objects are emitted from the model. Unchanged parts are spliced back from the original file.
- **Full-regeneration fallback:** some constructs make per-object patching unsafe: `^MU` unit scaling, non-default `^CC`/`^CT`/`^CD` command prefixes, non-UTF-8 `^CI` encoding, non-default `^FE` embed delimiters, an `^FN` declared without a field, an in-span `^JM` density switch, and a barcode relying on a previous `^BY`. If one is present, the first edit regenerates the whole label; with no edits the export stays byte-for-byte.

Byte capture is deliberately conservative. If a field cannot be mapped cleanly to one object, the whole label falls back to model regeneration; content stays intact, but exact bytes may change. Captured bytes are stored in `.json` designs. Designs from older capture formats are detected and rebuilt.

### Multiple labels (pages)

Use File menu → **Add page** to create another page. With multiple pages, the bottom-center page control switches between pages and removes them. All pages share the same dimensions; export and import handle each page as a separate label.

### Batch printing from data

Use File menu → **Import CSV data** to load a CSV. The mapping dialog pairs variables with columns and saves that mapping in the design. **Export batch ZPL** or **Send to Zebra Printer** then outputs one label per row.

On desktop, **Import Excel data** reads a worksheet. **Printer settings… → Data sources** can also load rows from a read-only SQLite, PostgreSQL or MySQL database, with the password stored in the OS keychain. The same mapping and batch output apply, and a design remembers its database link for one-click reload.

### Printer settings

Use File menu → **Printer settings…** to configure label-level media and print quality. The Setup Script covers clock, locale, encoding and printer identity, and is meant to be sent once when setting up a printer. Setup Script values stay out of saved designs so sharing a `.zpl` or `.json` does not leak your printer name or locale.

The **Preview** tab selects the preview renderer: Labelary's online service, or on desktop the connected printer's own firmware. It can also store a premium Labelary endpoint and API key; the key is stored in the OS keychain on desktop and in browser storage on the web.

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
| `↑` / `↓` / `Enter` in the command reference | Navigate the list / insert the highlighted command |
| `Esc` in the command reference | Unpin the row |

### Saving and loading

Both `.zpl` and `.json` files round-trip cleanly. `.zpl` preserves printable content and remains editable: re-import it and keep working. `.json` (File → Save Design) also stores designer-only state with no ZPL representation, including locked/hidden objects, items excluded from export, custom object names and group structure.

---

## Features

- Smart alignment and spacing guides
- Layers panel with reordering
- Editable ZPL source: type directly in the output panel while the canvas previews the draft live ([editing the ZPL source](#editing-the-zpl-source))
- ZPL command reference: searchable details for every ZPL II command, following the caret and showing concise explanations plus support status
- Lossless ZPL round-trip: imported ZPL re-exports byte-for-byte, regenerating only edited objects ([import guarantees](#import-guarantees))
- Variables: bind text and barcode fields to named defaults that emit as `^FN` slots, or `^FE` inline embeds when one field references multiple variables
- Batch printing: map variables to CSV, Excel or read-only database columns, then print or export one label per row
- GS1 content builder: assemble DataBar Expanded, GS1-128 and GS1 DataMatrix content from Application Identifiers, with field and combination validation
- Content builder: generate QR, Data Matrix and Aztec payloads for URLs, WiFi, contacts, email, phone, SMS and geo coordinates
- EAN/UPC inline validation: live length counter, computed check-digit preview, and a GS1 prefix hint below the content field
- Printer settings: label-level hardware tuning plus a Setup Script for clock, locale, encoding and printer identity
- 32 UI languages (auto-detected from browser)
- Light / dark mode (follows OS setting)

---

## Coverage

<!-- coverage:start (generated from the command catalog by scripts/gen-coverage.mjs; run `pnpm coverage:gen`) -->
115 of the 225 ZPL II commands are modelled in the browser; desktop covers 2 more with a connected printer. 4 more are planned for both builds. 82 need a connected printer and are planned for desktop. The source editor does not lint command parameters yet. See per-command coverage: [docs/zpl-coverage.md](docs/zpl-coverage.md).

| Area | Modelled |
|---|---|
| Layout & flow | 15 / 15 |
| Templates & variables | 1 / 3 |
| Barcodes | 29 / 29 |
| Fields | 16 / 17 |
| Serialisation | 2 / 2 |
| Encoding & language | 3 / 3 |
| Clock & time | 4 / 4 |
| Identity & access | 2 / 2 |
| Graphics | 7 / 14 |
| Media & feed | 9 / 9 |
| Text & fonts | 9 / 15 |
| Print quality | 10 / 18 |
| Configuration & persistence | 4 / 5 |
| Hardware / Host comm / RFID / Network | 4 / 89 |
<!-- coverage:end -->

---

## Limitations

- The canvas is a design preview, not a pixel-perfect simulation. Shapes, spacing and positions match the print; text approximates Zebra's built-in font to within a few dots, but exact letterforms and anti-aliasing differ. For a faithful render, use **Preview** in the bottom-right panel.
- The default preview renderer is Labelary; the web build calls `api.labelary.com`. Self-hosters can configure a private endpoint or disable online previews. The desktop app can preview on the connected printer instead.
- The Labelary preview does not render every ZPL feature. Some less common elements, such as CODABLOCK F or MaxiCode, may be missing or inaccurate in the preview even when the actual print is correct.
- The preview shows only the current page with either renderer; the printed/exported ZPL still contains every page.

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
