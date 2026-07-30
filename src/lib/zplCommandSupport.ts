/**
 * Machine-readable support matrix for ZPL II commands.
 *
 * Purpose: single source of truth for documentation, import-report
 * categorisation in the UI, and as a baseline for regression testing.
 * Keep in sync with zplParser.ts.
 */

/** Import fidelity when a ZPL command is parsed by this designer. */
type ZplCommandStatus =
  | 'supported'      // Fully imported; no design information is lost
  | 'partial'        // Imported with known limitations (see ZplCommandInfo.loss)
  | 'structural'     // Carries no design content; correctly ignored (^XA, ^XZ, ^FX …)
  | 'browser-limit'  // Requires printer hardware / file storage; cannot be used in the browser
  | 'unsupported';   // Carries design information but not yet implemented

/** Locale key (importReport block) describing the loss; keys instead of
 *  prose so the import report renders in the UI language. */
export type ImportLossKey =
  | 'lossFontFace'
  | 'lossPrinterComms'
  | 'lossGfRawBinary'
  | 'lossFileStorage'
  | 'lossPrinterStorage';

interface ZplCommandInfo {
  /** 2-character ZPL command code, uppercase, without the leading ^ or ~ */
  cmd: string;
  /** Brief description of what this ZPL command does */
  description: string;
  /** Import fidelity status */
  status: ZplCommandStatus;
  /** What is lost or approximated when status is 'partial' or 'browser-limit' */
  loss?: ImportLossKey;
}

const ZPL_COMMANDS: readonly ZplCommandInfo[] = [
  // ── Label layout ──────────────────────────────────────────────────────────
  { cmd: 'XA', status: 'structural', description: 'Start format (label start marker)' },
  { cmd: 'XZ', status: 'structural', description: 'End format / print label' },
  { cmd: 'PW', status: 'supported', description: 'Print width: sets label width in dots' },
  { cmd: 'LL', status: 'supported', description: 'Label length: sets label height in dots' },
  { cmd: 'LH', status: 'supported', description: 'Label home: global origin offset applied to all fields' },
  { cmd: 'LS', status: 'supported', description: 'Label shift: horizontal offset in dots' },
  { cmd: 'LT', status: 'supported', description: 'Label top: vertical offset applied to all field positions' },
  { cmd: 'PQ', status: 'supported', description: 'Print quantity' },
  { cmd: 'MM', status: 'supported', description: 'Media mode (T tear-off, V peel, D cutter, K kiosk)' },
  { cmd: 'MT', status: 'structural', description: 'Media type: printer hardware setting, not relevant for canvas design' },

  // ── Field positioning ─────────────────────────────────────────────────────
  { cmd: 'FO', status: 'supported', description: 'Field origin: absolute position from label home' },
  { cmd: 'FT', status: 'supported', description: 'Field top: position measured from top-left of label' },

  // ── Field data & modifiers ────────────────────────────────────────────────
  { cmd: 'FD', status: 'supported', description: 'Field data: content payload for the current field' },
  { cmd: 'FS', status: 'supported', description: 'Field separator: ends the current field' },
  { cmd: 'FH', status: 'supported', description: 'Field hex indicator: enables _XX hex-escape sequences in ^FD' },
  { cmd: 'FR', status: 'supported', description: 'Field reverse: inverts colours for this field only' },
  { cmd: 'FX', status: 'structural', description: 'Comment field: ignored' },
  { cmd: 'FW', status: 'supported', description: 'Field orientation: sets default rotation for subsequent fields' },
  { cmd: 'FB', status: 'supported', description: 'Field block: multi-line text with word-wrap and justification' },
  { cmd: 'FC', status: 'supported', description: 'Field clock: redefines the clock chars used for inline date/time tokens inside ^FD. Tokens import as «clock:T» markers; canvas previews the current date, generator round-trips through ^FC + tokens.' },
  { cmd: 'FE', status: 'supported', description: 'Field-number embed character: redefines the ^FN inline-embed delimiter (default #) used by ^FD. Imported embeds become «name» template markers; round-trips through generate.' },
  { cmd: 'FM', status: 'unsupported', description: 'Multiple field origin locations' },
  { cmd: 'FN', status: 'supported', description: 'Field number: variable field placeholder, lands in the Variables tab on import and emits as ^FN{slot} on export' },
  { cmd: 'FP', status: 'supported', description: 'Field parameter; sets character-by-character text direction (vertical CJK / reverse RTL layout)' },
  { cmd: 'FV', status: 'supported', description: 'Field variable: data-equivalent of ^FD for variable fields; imports like ^FD and re-emits as ^FD (print-time clearing under ^MC reuse is not modeled)' },

  // ── Fonts & text ──────────────────────────────────────────────────────────
  { cmd: 'A0', status: 'supported', description: 'Scalable/bitmap font 0: primary designer font' },
  { cmd: 'CF', status: 'supported', description: 'Change default font: sets height/width for subsequent text fields' },
  {
    cmd: 'A@', status: 'partial',
    description: 'TrueType/OpenType font reference by device path',
    loss: 'lossFontFace',
  },
  { cmd: 'TB', status: 'supported', description: 'Text block: alternative to ^A + ^FB for wrapped/justified text' },
  { cmd: 'PA', status: 'supported', description: 'Advanced text properties: glyph/bidi/shaping/OpenType flags; round-trips through the Printer Settings setup script' },
  { cmd: 'CW', status: 'supported', description: 'Font identifier: alias-to-font mapping, round-trips; canvas renders the substitute font' },
  { cmd: 'FL', status: 'supported', description: 'Font linking: round-trips through the Printer Settings setup script' },
  {
    cmd: 'HT', status: 'browser-limit',
    description: 'Host linked font list: retrieves font data from printer',
    loss: 'lossPrinterComms',
  },
  {
    cmd: 'LF', status: 'browser-limit',
    description: 'List font links: retrieves linked font info from printer',
    loss: 'lossPrinterComms',
  },

  // ── Reverse / invert ──────────────────────────────────────────────────────
  { cmd: 'LR', status: 'supported', description: 'Label reverse: inverts colours for all subsequent fields' },

  // ── Barcodes ──────────────────────────────────────────────────────────────
  { cmd: 'BY', status: 'supported', description: 'Bar code field default: sets module width, ratio, height' },
  { cmd: 'B0', status: 'supported', description: 'Aztec barcode' },
  { cmd: 'B1', status: 'supported', description: 'Code 11 barcode' },
  { cmd: 'B2', status: 'supported', description: 'Interleaved 2 of 5 barcode' },
  { cmd: 'B3', status: 'supported', description: 'Code 39 barcode' },
  { cmd: 'B4', status: 'supported', description: 'Code 49 barcode' },
  { cmd: 'B5', status: 'supported', description: 'Planet Code barcode' },
  { cmd: 'B7', status: 'supported', description: 'PDF417 barcode' },
  { cmd: 'B8', status: 'supported', description: 'EAN-8 barcode' },
  { cmd: 'B9', status: 'supported', description: 'UPC-E barcode' },
  { cmd: 'BA', status: 'supported', description: 'Code 93 barcode' },
  { cmd: 'BB', status: 'supported', description: 'CODABLOCK barcode' },
  { cmd: 'BC', status: 'supported', description: 'Code 128 barcode' },
  { cmd: 'BD', status: 'supported', description: 'UPS MaxiCode barcode' },
  { cmd: 'BE', status: 'supported', description: 'EAN-13 barcode' },
  { cmd: 'BF', status: 'supported', description: 'MicroPDF417 barcode' },
  { cmd: 'BI', status: 'supported', description: 'Industrial 2 of 5 barcode' },
  { cmd: 'BJ', status: 'supported', description: 'Standard 2 of 5 barcode' },
  { cmd: 'BK', status: 'supported', description: 'ANSI Codabar barcode' },
  { cmd: 'BL', status: 'supported', description: 'LOGMARS barcode' },
  { cmd: 'BM', status: 'supported', description: 'MSI barcode' },
  { cmd: 'BO', status: 'supported', description: 'Aztec barcode (alternate)' },
  { cmd: 'BP', status: 'supported', description: 'Plessey barcode' },
  { cmd: 'BQ', status: 'supported', description: 'QR Code' },
  { cmd: 'BR', status: 'supported', description: 'GS1 Databar' },
  { cmd: 'BS', status: 'supported', description: 'UPC/EAN 2- or 5-digit supplement barcode' },
  { cmd: 'BT', status: 'supported', description: 'TLC39 barcode (MicroPDF417 + Code 39)' },
  { cmd: 'BU', status: 'supported', description: 'UPC-A barcode' },
  { cmd: 'BX', status: 'supported', description: 'DataMatrix code' },
  { cmd: 'BZ', status: 'supported', description: 'POSTAL barcode' },

  // ── Graphics ──────────────────────────────────────────────────────────────
  { cmd: 'GB', status: 'supported', description: 'Graphic box: also interpreted as a line when one dimension equals thickness' },
  { cmd: 'GD', status: 'supported', description: 'Graphic diagonal line' },
  { cmd: 'GE', status: 'supported', description: 'Graphic ellipse' },
  { cmd: 'GC', status: 'supported', description: 'Graphic circle (mapped to ellipse with equal width/height)' },
  {
    cmd: 'GF', status: 'partial',
    description: 'Graphic field: embedded monochrome bitmap',
    loss: 'lossGfRawBinary',
  },
  { cmd: 'GS', status: 'supported', description: 'Graphic symbol glyph (registered/copyright/trademark/UL/CSA)' },

  // ── Serialisation ─────────────────────────────────────────────────────────
  { cmd: 'SN', status: 'supported', description: 'Serialisation data (^SNv,n,z; the start value is the field data)' },
  { cmd: 'SF', status: 'supported', description: 'Serialize field (^SFa,b; mask + increment on a ^FD string)' },

  // ── Clock & time ──────────────────────────────────────────────────────────
  { cmd: 'SO', status: 'supported', description: 'Set offset: secondary/tertiary RTC clock offsets; round-trips via labelConfig' },

  // ── Fonts & panel ─────────────────────────────────────────────────────────
  { cmd: 'CO', status: 'supported', description: 'Cache on: size the scalable-character cache (on/off, extra KB, buffer type); session-scoped' },
  { cmd: 'MP', status: 'supported', description: 'Mode protection: lock control-panel modes; one letter per command, E re-enables all' },
  { cmd: 'CV', status: 'supported', description: 'Code validation: round-trips through the Printer Settings setup script' },

  // ── Encoding ──────────────────────────────────────────────────────────────
  { cmd: 'CI', status: 'supported', description: 'Change international encoding: parsed on import; exports emit ^CI28 (UTF-8)' },

  // ── Control & media ───────────────────────────────────────────────────────
  { cmd: 'MC', status: 'supported', description: 'Map clear: Y clears the bitmap per label (default); N retains it behind subsequent labels' },
  { cmd: 'MD', status: 'structural', description: 'Media darkness: printer hardware setting' },
  { cmd: 'ML', status: 'structural', description: 'Maximum label length: printer calibration value' },
  { cmd: 'MN', status: 'structural', description: 'Media tracking: continuous/gap/mark sensing (hardware)' },

  // ── Print control ─────────────────────────────────────────────────────────
  { cmd: 'PF', status: 'supported', description: 'Slew given number of dot rows (0-32000) instead of printing a blank bottom area' },
  { cmd: 'PH', status: 'supported', description: 'Slew to home: feed one blank label after the format prints (caret form; ~PH is a device action)' },
  { cmd: 'PM', status: 'supported', description: 'Print mirror image: round-trips as label config' },
  { cmd: 'PO', status: 'supported', description: 'Print orientation: round-trips as label config' },
  { cmd: 'PP', status: 'supported', description: 'Programmable pause after the format prints, until PAUSE or ~PS (caret form; ~PP is a device action)' },
  { cmd: 'PR', status: 'structural', description: 'Print rate: sets print speed (hardware)' },
  { cmd: 'PS', status: 'structural', description: 'Print start: resumes printing after a pause (hardware)' },
  { cmd: 'JS', status: 'supported', description: 'Change backfeed sequence (A/B/N/O or percent 10-90, rounded to tens like the printer)' },
  { cmd: 'JM', status: 'supported', description: 'Set dots per millimeter: B halves the density, dot values then count in the halved scale' },

  // ── Printer storage & resources ───────────────────────────────────────────
  {
    cmd: 'IM', status: 'browser-limit',
    description: 'Image recall from printer memory',
    loss: 'lossFileStorage',
  },
  {
    cmd: 'DG', status: 'browser-limit',
    description: 'Download graphic to printer storage (~DG)',
    loss: 'lossPrinterStorage',
  },

  // Templates & batch merge: ^DF/^XF with R: drive path for CSV-driven batch printing.
  { cmd: 'DF', status: 'supported', description: 'Download format; used as ^DFR:LBL.ZPL to store the design template once, recalled per CSV row during batch export' },
  { cmd: 'XF', status: 'supported', description: 'Recall format; pulled per row in batch export, paired with ^FN overrides' },
  { cmd: 'XG', status: 'supported', description: 'Recall graphic; used together with ~DY for printer-resident images' },
  { cmd: 'DY', status: 'supported', description: 'Download object (~DY); embeds custom fonts and graphics so the printer can resolve ^A aliases and ^XG recalls' },
] as const;

/** O(1) lookup map: command code → info */
export const ZPL_COMMAND_MAP: ReadonlyMap<string, ZplCommandInfo> =
  new Map(ZPL_COMMANDS.map((c) => [c.cmd, c]));

