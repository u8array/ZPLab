/** One `key : value` line of an SGD dump. */
export interface SgdSetting {
  key: string;
  value: string;
}

/** A single getvar answers the value without its key, so the whole configuration is read under this one key. */
export const SGD_ALL_SETTINGS = 'allcv';

/** The getvar command without its terminator, so a progress text can name it. */
export const sgdGetvarCommand = (key: string): string => `! U1 getvar "${key}"`;

/** The getvar line a printer reads on its raw port. */
export const sgdGetvar = (key: string): string => `${sgdGetvarCommand(key)}\r\n`;

const SETTING_RE = /^([A-Za-z0-9_.]+)\s*:\s*(.*)$/;
const CHOICES_RE = /\s*,\s*Choices\s*:\s*(.*)$/i;

/** The settings an SGD dump lists, dropping every line without a `key :` opening such as a group header or a valueless command. */
export function parseSgdDump(text: string): SgdSetting[] {
  const settings: SgdSetting[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const setting = SETTING_RE.exec(line.trim());
    if (!setting) continue;
    const rest = setting[2] ?? '';
    const choices = CHOICES_RE.exec(rest);
    settings.push({
      key: setting[1] ?? '',
      value: (choices ? rest.slice(0, choices.index) : rest).trim(),
    });
  }
  return settings;
}

/** The value a key holds, or undefined when the dump lacks the key or left it empty. */
export function sgdValues(settings: readonly SgdSetting[]): (key: string) => string | undefined {
  const byKey = new Map(settings.filter((s) => s.value !== '').map((s) => [s.key, s.value]));
  return (key) => byKey.get(key);
}
