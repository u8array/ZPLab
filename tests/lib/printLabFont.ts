import * as fs from 'fs';
import * as path from 'path';
import { GlobalFonts } from '@napi-rs/canvas';

export const PRINTLAB_FONT_FAMILY = 'PrintLab ZPL';
export const PRINTLAB_FONT_PATH = path.resolve(
  process.cwd(),
  'src/assets/fonts/PrintLabZPL-Bold.ttf',
);

/** Single home for path and family so a font swap cannot leave a gate
 *  testing the old face. */
export function registerPrintLabZpl(): void {
  if (!fs.existsSync(PRINTLAB_FONT_PATH)) {
    throw new Error(`Font file missing at ${PRINTLAB_FONT_PATH}`);
  }
  GlobalFonts.registerFromPath(PRINTLAB_FONT_PATH, PRINTLAB_FONT_FAMILY);
}
