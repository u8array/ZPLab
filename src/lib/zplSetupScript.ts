import {
  HEAD_CLEANING_INTERVAL_METERS,
  JH_SLOT_COUNT,
  JH_SLOT_F,
  JH_SLOT_G,
  type PrinterProfile,
} from '@zplab/core/types/PrinterProfile';
import { formatFontDownloadFromPath } from '@zplab/core/lib/customFonts';
import { trimTrailingEmptySlots } from '@zplab/core/lib/zplGenerator';
import { formatRealtimeClockForZpl, toLocalIsoString } from '@zplab/core/lib/realtimeClock';

/** Generates the one-shot Setup-Script ZPL for a printer profile:
 *  EEPROM-persistent state (~TA, ^JZ, ^JT, clock / encoding / identity)
 *  meant to be sent once at provisioning, not on every print job.
 *  Returns '' when no field is set so callers can hide the pane without
 *  a separate predicate. Default-value emits (`~TA000`, `^JZY`, …) are
 *  kept rather than skipped: emitting the documented default is the
 *  only way to be sure the field actually lands there after an
 *  earlier script left the printer in a non-default state. */

type SetupScriptEntry =
  | { kind: 'emit'; channel: 'tilde'; emit: (p: PrinterProfile) => string | null }
  // `scope` is required on block entries so every new command makes the
  // persistence call explicit; 'session' entries emit after ^JUS.
  | { kind: 'emit'; channel: 'block'; scope: 'persistent' | 'session'; emit: (p: PrinterProfile) => string | null }
  | { kind: 'foldedInto'; target: keyof PrinterProfile };

const SETUP_SCRIPT_EMITTERS = {
  // Fonts ship before any block command so ^FL inside the persistent
  // block resolves against them in the same provisioning send.
  setupFonts: {
    kind: 'emit',
    channel: 'tilde',
    emit: (p) => {
      const lines = p.setupFonts?.flatMap((f) => {
        const line = formatFontDownloadFromPath(f.path);
        return line ? [line] : [];
      }) ?? [];
      return lines.length > 0 ? lines.join('\n') : null;
    },
  },
  tearOffAdjust: {
    kind: 'emit',
    channel: 'tilde',
    // Spec: "if the number of characters is less than 3, the command
    // is ignored." `~TA5` is dropped by firmware; correct form is
    // `~TA005`. Sign sits outside the 3-digit width.
    emit: (p) => {
      if (p.tearOffAdjust === undefined) return null;
      const v = p.tearOffAdjust;
      const sign = v < 0 ? '-' : '';
      const mag = String(Math.abs(v)).padStart(3, '0');
      return `~TA${sign}${mag}`;
    },
  },
  reprintAfterError: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.reprintAfterError !== undefined ? `^JZ${p.reprintAfterError}` : null,
  },
  headTestInterval: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.headTestInterval !== undefined ? `^JT${p.headTestInterval}` : null,
  },
  setRealtimeClock: {
    kind: 'emit',
    channel: 'block',
    // ^ST writes the on-board battery-backed RTC, not EEPROM; ^JUS is a
    // no-op for it. Grouped with 'persistent' purely for emit order.
    scope: 'persistent',
    // Live mode (useCurrentTimeForClock) captures now() at emit-time
    // and wins over the stored static value. Toggling the checkbox in
    // the UI is therefore unambiguous regardless of stored ISO state.
    emit: (p) => {
      if (p.useCurrentTimeForClock) {
        const params = formatRealtimeClockForZpl(toLocalIsoString());
        return params !== null ? `^ST${params}` : null;
      }
      if (p.setRealtimeClock === undefined) return null;
      const params = formatRealtimeClockForZpl(p.setRealtimeClock);
      return params !== null ? `^ST${params}` : null;
    },
  },
  useCurrentTimeForClock: { kind: 'foldedInto', target: 'setRealtimeClock' },
  clockFormat: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.clockFormat !== undefined ? `^KD${p.clockFormat}` : null,
  },
  printerLocale: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.printerLocale !== undefined ? `^KL${p.printerLocale}` : null,
  },
  encodingTable: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.encodingTable !== undefined ? `^SE${p.encodingTable}` : null,
  },
  zplMode: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.zplMode !== undefined ? `^SZ${p.zplMode}` : null,
  },
  printerName: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => {
      if (p.printerName === undefined) return null;
      // Trim both halves: parser trims on import; asymmetric whitespace
      // would break the round-trip invariant. Whitespace-only name
      // drops the emit so the parser's "no name = no ^KN" rule holds.
      const name = p.printerName.trim();
      if (!name) return null;
      const desc = p.printerDescription?.trim();
      return desc ? `^KN${name},${desc}` : `^KN${name}`;
    },
  },
  printerDescription: { kind: 'foldedInto', target: 'printerName' },
  setPassword: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.setPassword !== undefined ? `^KP${p.setPassword}` : null,
  },
  clockMode: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    // ^SL `a` slot is tri-shape: 'S', 'T', or numeric tolerance (TOL
    // mode). Schema's cross-field refine guarantees TOL always has a
    // defined clockTolerance, so no fallback needed.
    emit: (p) => {
      if (p.clockMode === undefined) return null;
      const a = p.clockMode === 'TOL' ? String(p.clockTolerance) : p.clockMode;
      const b = p.clockLanguage;
      return b !== undefined ? `^SL${a},${b}` : `^SL${a}`;
    },
  },
  clockTolerance: { kind: 'foldedInto', target: 'clockMode' },
  // Drop bare `^SL,<lang>` (mode unset): spec leaves the shape
  // implementation-defined.
  clockLanguage: { kind: 'foldedInto', target: 'clockMode' },
  // ^JH precedes ^MA so the master gate is on when the alert lands;
  // otherwise the printer discards the alert until ^JUS + reboot.
  // earlyWarningMaintenance owns the composite emit;
  // headCleaningIntervalMeters folds in.
  earlyWarningMaintenance: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => {
      if (p.earlyWarningMaintenance === undefined && p.headCleaningIntervalMeters === undefined) {
        return null;
      }
      const slots: string[] = Array<string>(JH_SLOT_COUNT).fill('');
      slots[JH_SLOT_F] = p.earlyWarningMaintenance ?? '';
      if (p.headCleaningIntervalMeters !== undefined) {
        const idx = HEAD_CLEANING_INTERVAL_METERS.indexOf(
          p.headCleaningIntervalMeters as (typeof HEAD_CLEANING_INTERVAL_METERS)[number],
        );
        if (idx >= 0) slots[JH_SLOT_G] = String(idx);
      }
      return `^JH${slots.join(',')}`;
    },
  },
  headCleaningIntervalMeters: { kind: 'foldedInto', target: 'earlyWarningMaintenance' },
  maintenanceAlert: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => {
      const m = p.maintenanceAlert;
      if (!m) return null;
      return `^MA${m.type},${m.print},${m.threshold},${m.frequency},${m.units}`;
    },
  },
  maintenanceMessage: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.maintenanceMessage
      ? `^MI${p.maintenanceMessage.type},${p.maintenanceMessage.text}`
      : null,
  },
  headColdWarning: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.headColdWarning !== undefined ? `^MW${p.headColdWarning}` : null,
  },
  // One ^FL per active link; persisted by the trailing ^JUS.
  fontLinks: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => {
      // Trim symmetrically with the parser so whitespace-only rows
      // don't break the round-trip.
      const valid = p.fontLinks?.filter((l) => l.ext.trim().length > 0 && l.base.trim().length > 0);
      if (!valid || valid.length === 0) return null;
      return valid.map((l) => `^FL${l.ext.trim()},${l.base.trim()},1`).join('\n');
    },
  },
  // Last persistent entry: ^JUS must follow every persistent write so the
  // EEPROM commits the block. Tripwire in zplSetupScript.test.ts pins this.
  configurationUpdate: {
    kind: 'emit',
    channel: 'block',
    scope: 'persistent',
    emit: (p) => p.configurationUpdate !== undefined ? `^JU${p.configurationUpdate}` : null,
  },
  codeValidation: {
    kind: 'emit',
    channel: 'block',
    scope: 'session',
    emit: (p) => p.codeValidation !== undefined ? `^CV${p.codeValidation}` : null,
  },
  // ^PA advanced text properties (4 slots a-d, each 0/1). paSlotA owns
  // the composite emit; b/c/d fold in. Emitted only when at least one
  // slot is set so default labels stay byte-identical.
  paSlotA: {
    kind: 'emit',
    channel: 'block',
    scope: 'session',
    emit: (p) => {
      if (!p.paSlotA && !p.paSlotB && !p.paSlotC && !p.paSlotD) return null;
      const b = (v: boolean | undefined) => v ? '1' : '0';
      return `^PA${b(p.paSlotA)},${b(p.paSlotB)},${b(p.paSlotC)},${b(p.paSlotD)}`;
    },
  },
  paSlotB: { kind: 'foldedInto', target: 'paSlotA' },
  paSlotC: { kind: 'foldedInto', target: 'paSlotA' },
  paSlotD: { kind: 'foldedInto', target: 'paSlotA' },
  // ^CO sizes the DRAM character cache: session state, gone at power-off.
  // fontCacheOn owns the composite; unset slots stay EMPTY (printer applies
  // its spec defaults) so parse(generate(p)) returns exactly p.
  fontCacheOn: {
    kind: 'emit',
    channel: 'block',
    scope: 'session',
    emit: (p) => {
      const slots = trimTrailingEmptySlots([
        p.fontCacheOn ?? '',
        p.fontCacheAddKb?.toString() ?? '',
        p.fontCacheType ?? '',
      ]);
      return slots.length > 0 ? `^CO${slots.join(',')}` : null;
    },
  },
  fontCacheAddKb: { kind: 'foldedInto', target: 'fontCacheOn' },
  fontCacheType: { kind: 'foldedInto', target: 'fontCacheOn' },
  // ^MPE baseline only for an absolute set; a relative import (^MPD without
  // ^MPE) re-emits additions only, since injecting the reset would first
  // unprotect everything else. Never tied to ^JUS, so session-scoped.
  modeProtection: {
    kind: 'emit',
    channel: 'block',
    scope: 'session',
    emit: (p) => {
      if (p.modeProtection === undefined) return null;
      const lines = [
        ...(p.modeProtectionExplicit ? ['^MPE'] : []),
        ...p.modeProtection.map((m) => `^MP${m}`),
      ];
      return lines.length > 0 ? lines.join('\n') : null;
    },
  },
  modeProtectionExplicit: { kind: 'foldedInto', target: 'modeProtection' },
} as const satisfies Partial<Record<keyof PrinterProfile, SetupScriptEntry>>;

/** Public list of the PrinterProfile fields that flow through the
 *  Setup-Script generator. Derived from the registry so the two
 *  cannot drift. */
export const SETUP_SCRIPT_FIELDS = Object.keys(
  SETUP_SCRIPT_EMITTERS,
) as readonly SetupScriptField[];

export type SetupScriptField = keyof typeof SETUP_SCRIPT_EMITTERS;

/** Test-only re-export so an invariant check can walk foldedInto
 *  targets without re-implementing the registry shape. */
export const __SETUP_SCRIPT_EMITTERS_FOR_TESTS = SETUP_SCRIPT_EMITTERS;

export function generateSetupScript(profile: PrinterProfile): string {
  const tildeLines: string[] = [];
  const persistentBlock: string[] = [];
  const sessionBlock: string[] = [];

  for (const field of SETUP_SCRIPT_FIELDS) {
    const e = SETUP_SCRIPT_EMITTERS[field];
    if (e.kind !== 'emit') continue;
    const line = e.emit(profile);
    if (line === null) continue;
    if (e.channel === 'tilde') {
      tildeLines.push(line);
      continue;
    }
    // Exhaustive on scope: a future variant forces a case here at
    // compile time instead of silently falling through to persistent.
    switch (e.scope) {
      case 'persistent': persistentBlock.push(line); break;
      case 'session': sessionBlock.push(line); break;
      default: {
        const _exhaustive: never = e;
        throw new Error(`unhandled scope on emit entry: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
  // Order is load-bearing: session entries trail ^JUS so the commit
  // never tries to persist them.
  const blockLines = [...persistentBlock, ...sessionBlock];

  if (tildeLines.length === 0 && blockLines.length === 0) return '';

  const out = [...tildeLines];
  if (blockLines.length > 0) {
    out.push('^XA', ...blockLines, '^XZ');
  }
  return out.join('\n');
}
