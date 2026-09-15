import { describe, it, expect } from 'vitest';
import { DEVICE_ACTION_IDS, parseZPL } from '@zplab/core/lib/zplParser';
import { ZPL_COMMANDS, catalogEntry, commandId, commandTwinSplit } from '@zplab/core/catalog';
import { opensImmediateCommand } from '@zplab/core/lib/zplImmediate';
import { createParserState } from '@zplab/core/lib/zplParser/context';
import { createLabelConfigHandlers } from '@zplab/core/lib/zplParser/handlers/labelConfig';
import { createSetupScriptHandlers } from '@zplab/core/lib/zplParser/handlers/setupScript';
import { createUnsupportedHandlers } from '@zplab/core/lib/zplParser/handlers/unsupported';
import { commandsOf, defined, parseSingle, props } from '../test/helpers';

const baseline = parseSingle('^XA^XZ', 8).labelConfig;

describe('parseZPL — the catalog is the one source of prefix knowledge', () => {
  it('opens an immediate command inside field data exactly for the names the catalog lists under ~', () => {
    const names = new Set(ZPL_COMMANDS.map((entry) => entry.cmd));
    for (const name of names) {
      const listedUnderTilde = ZPL_COMMANDS.some((entry) => entry.cmd === name && entry.prefixes.includes('~'));
      expect(opensImmediateCommand(name), name).toBe(listedUnderTilde);
    }
    expect(opensImmediateCommand('SE')).toBe(false);
    expect(opensImmediateCommand('PL')).toBe(true);
  });

  it('ends a field at a ~PL and keeps a ~SE as data, as the spec spells the two', () => {
    const cut = parseSingle('^XA^FO0,0^A0N,30,30^FDab~PLcd^FS^XZ', 8);
    expect(props(cut.objects[0]).content).toBe('ab');
    const kept = parseSingle('^XA^FO0,0^A0N,30,30^FDab~SEcd^FS^XZ', 8);
    expect(props(kept.objects[0]).content).toBe('ab~SEcd');
  });

  it('dispatches each twin spelling to its own command', () => {
    expect(parseSingle('^XA^PH^PP^PMY^PR4,5,6^XZ', 8).labelConfig).toMatchObject({
      slewToHome: true, programmablePause: true, mirror: 'Y', printSpeed: 4, slewSpeed: 5, backfeedSpeed: 6,
    });
    const tilde = parseSingle('~PH~PP~PMY~PR4\n^XA^XZ', 8);
    expect(tilde.labelConfig).toEqual(baseline);
    expect(commandsOf(tilde, 'deviceAction')).toEqual(['~PH', '~PP', '~PMY', '~PR4']);
    expect(commandsOf(tilde, 'unknown')).toEqual([]);
    expect(parseSingle('~JSB\n^XA^XZ', 8).labelConfig.backfeedSequence).toBe('B');
    const caretJs = parseSingle('^XA^JSB^XZ', 8);
    expect(caretJs.labelConfig).toEqual(baseline);
    expect(commandsOf(caretJs, 'deviceAction')).toEqual(['^JSB']);
  });

  it('keeps every unmodelled twin side out of the model, whatever the catalog adds later', () => {
    const twins = ZPL_COMMANDS.filter((e) => commandTwinSplit(e.cmd) && e.support.web === 'no');
    expect(twins.length).toBeGreaterThan(0);
    for (const entry of twins) {
      const spelled = commandId(entry);
      const zpl = spelled.startsWith('~') ? `${spelled}\n^XA^XZ` : `^XA${spelled}^XZ`;
      const r = parseSingle(zpl, 8);
      expect(r.labelConfig, spelled).toEqual(baseline);
      expect(r.findings.map((f) => f.command), spelled).toContain(spelled);
    }
  });

  it('lists only real catalog ids as device actions', () => {
    for (const id of DEVICE_ACTION_IDS) expect(catalogEntry(id), id).toBeDefined();
  });

  it('registers twin-split names only under spelled keys, and setup-script codes only bare', () => {
    const s = createParserState();
    const keys = [...Object.keys(createLabelConfigHandlers(s, 8)), ...Object.keys(createUnsupportedHandlers(s))];
    const bareTwins = keys.filter((key) => !/^[\^~]/.test(key) && commandTwinSplit(key));
    expect(bareTwins).toEqual([]);
    expect(Object.keys(createSetupScriptHandlers(s)).filter((key) => /^[\^~]/.test(key))).toEqual([]);
  });

  it('quotes a browser-limit token under the live prefix chars', () => {
    const tilde = parseZPL('^CT#\n#DYR:LOGO,A,G,x,1,00FFFF00\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ', 8);
    expect(defined(tilde.pages[0]).findings.map((f) => [f.kind, f.command])).toContainEqual(['browserLimit', '#DYR:LOGO,A,G,x,1,00FFFF00']);
    const caret = parseSingle('^CC#\n#XA#FO0,0#XG,1,1#FS#XZ', 8);
    expect(commandsOf(caret, 'browserLimit')).toEqual(['#XG,1,1']);
  });
});
