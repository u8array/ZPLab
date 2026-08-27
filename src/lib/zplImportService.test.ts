import { describe, it, expect } from 'vitest';
import { importZplText, routeSetupCommands, mergeSetupFonts } from '@zplab/core/lib/zplImportService';
import { generateSetupScript } from './zplSetupScript';
import { generateMultiPageZPL } from '@zplab/core/lib/zplGenerator';
import { describeFinding } from './importReport';
import { fallbackTranslations } from '../locales';
import { replayRiskFindings, printerCommandFindings, resolveRoutedReport } from '@zplab/core/lib/importReport';
import type { PrinterProfile } from '@zplab/core/types/PrinterProfile';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';

describe('importZplText - cross-block parser state (parser-owned pages)', () => {
  it('carries ^MU units across ^XA blocks (persistent per spec)', () => {
    const r = importZplText('^XA^MUI^XZ^XA^FO1,1^A0N,0.5,0.5^FDX^FS^XZ', 8);
    const obj = r.pages.at(-1)?.objects[0] as { x: number; props: { fontHeight: number } };
    expect(obj.x).toBe(203); // 1 inch at 203 dpi
    expect(obj.props.fontHeight).toBe(102);
  });

  it('resolves a ^CW font alias defined in an earlier block', () => {
    const r = importZplText('^XA^CWM,E:ARIAL.TTF^XZ^XA^FO10,10^AMN,30,0^FDHi^FS^XZ', 8);
    expect(r.report.partial).not.toContain('^AM');
  });

  it('splits blocks after a ~CC command-prefix change', () => {
    const r = importZplText('~CC!!XA!FO50,50!FDA!FS!XZ!XA!FO60,60!FDB!FS!XZ', 8);
    expect(r.pages).toHaveLength(2);
  });

  it('does not leak a dangling ^FH hex-decode into the next block', () => {
    const r = importZplText('^XA^FH^XZ^XA^FO10,10^A0N,30,30^FD_41^FS^XZ', 8);
    const obj = r.pages.at(-1)?.objects[0] as { props: { content: string } };
    expect(obj.props.content).toBe('_41');
  });

  it('does not leak dangling ^FB block defaults into the next block', () => {
    const r = importZplText('^XA^FB400,2^XZ^XA^FO10,10^A0N,30,30^FDx^FS^XZ', 8);
    const obj = r.pages.at(-1)?.objects[0] as { props: { blockWidth?: number } };
    expect(obj.props.blockWidth).toBeUndefined();
  });

  it('keeps block 0 config; a later block ^PQ does not leak', () => {
    const r = importZplText('^XA^FO10,10^A0N,30,30^FDx^FS^XZ^XA^PQ99^XZ', 8);
    expect(r.labelConfig.printQuantity).toBeUndefined();
  });

  it('keeps block 0 config; a later block ^PF/^PH/^PP does not leak (format-scoped)', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ^XA^PF200^PH^PP^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    expect(r.labelConfig.slewDotRows).toBeUndefined();
    expect(r.labelConfig.slewToHome).toBeUndefined();
    expect(r.labelConfig.programmablePause).toBeUndefined();
  });

  // A folded-back ^MCN would retain page one's bitmap INTO page two on
  // re-export, garbage the original stream never printed.
  it('keeps block 0 config; a later block ^MC does not leak', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ^XA^MCN^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    expect(r.labelConfig.mapClear).toBeUndefined();
  });

  it('accepts the ZPLLAB sidecar from a later block while no object was seen (settings-block re-export)', () => {
    const sc = '^FXZPLLAB:{"dpmm":12,"wMm":100,"hMm":50}^FS';
    const r = importZplText(`^XA^MMT^XZ^XA${sc}^PW1200^LL600^FO10,10^A0N,30,30^FDx^FS^XZ`, 8);
    expect(r.labelConfig.dpmm).toBe(12);
    expect(r.labelConfig.widthMm).toBe(100);
    expect(r.labelConfig.heightMm).toBe(50);
  });

  it('ignores a ZPLLAB sidecar after the first design object', () => {
    const sc = '^FXZPLLAB:{"dpmm":12,"wMm":100,"hMm":50}^FS';
    const r = importZplText(`^XA^FO10,10^A0N,30,30^FDx^FS${sc}^XZ`, 8);
    expect(r.labelConfig.dpmm).toBeUndefined();
  });
});

describe('importZplText - replay-risk findings', () => {
  it('flags printer setup commands (run on the printer when exported/printed)', () => {
    const r = importZplText('^XA^KNFOO^FO10,10^A0N,30,30^FDx^FS^XZ', 8);
    expect(r.report.replayRisk).toContain('^KN');
    const finding = r.report.findings.find((f) => f.kind === 'replayRisk');
    expect(finding).toBeDefined();
    expect(describeFinding(finding!, fallbackTranslations.importReport).detail).toBe('^KN');
  });

  it('does not flag a label without setup commands', () => {
    const r = importZplText('^XA^FO10,10^A0N,30,30^FDx^FS^XZ', 8);
    expect(r.report.replayRisk).toEqual([]);
    expect(r.report.findings.some((f) => f.kind === 'replayRisk')).toBe(false);
  });

  it('dedupes a setup command repeated across pages', () => {
    const r = importZplText('^XA^STsome^XZ\n^XA^STmore^XZ', 8);
    expect(r.report.replayRisk).toEqual(['^ST']);
  });

  it('flags device-action commands (calibration/reset) as a distinct deviceAction kind', () => {
    const r = importZplText('^XA~JC~JR^FO10,10^A0N,30,30^FDx^FS^XZ', 8);
    // Not profile-backed: own kind, so routing never offers to "move" them.
    expect(r.report.deviceAction).toContain('~JC');
    expect(r.report.deviceAction).toContain('~JR');
    expect(r.report.replayRisk).toEqual([]);
  });

  it('does not flag design noops (^FM) or visible label settings (^MD/^PR)', () => {
    const r = importZplText('^XA^MD8^PR4^FM^FO10,10^A0N,30,30^FDx^FS^XZ', 8);
    expect(r.report.replayRisk).toEqual([]);
    expect(r.report.deviceAction).toEqual([]);
  });
});

describe('importZplText - partial-loss wording', () => {
  it('gives the QR loss its own wording, not the generic partial fallback', () => {
    const r = importZplText('^XA^FO10,10^BQN,2,4^FDHM,N12345^FS^XZ', 8);
    const finding = r.report.findings.find((f) => f.kind === 'partial' && f.command === '^BQ');
    expect(finding).toBeDefined();
    const { detail } = describeFinding(finding!, fallbackTranslations.importReport);
    expect(detail).toBe(fallbackTranslations.importReport.lossQrFdMode);
    expect(detail).not.toBe(fallbackTranslations.importReport.partialFallback);
  });

});

describe('importZplText - wrapper-less paste', () => {
  it('imports a bare body without ^XA/^XZ as a page', () => {
    const r = importZplText('^FO50,50^A0N,30,30^FDHello^FS', 8);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]?.objects).toHaveLength(1);
    expect(r.pages[0]?.objects[0]?.type).toBe('text');
    expect(r.pages[0]?.overlay).toBeUndefined(); // re-export regenerates the wrapper
  });

  it('does not create a page for a fields-less preamble', () => {
    const r = importZplText('^CWA,E:FONT.TTF', 8);
    expect(r.pages).toHaveLength(0);
  });
});

describe('importZplText - single label', () => {
  it('returns one page with the parsed objects', () => {
    const zpl = '^XA^FO10,20^A0N,30,0^FDHello^FS^XZ';
    const result = importZplText(zpl, 8);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.objects).toHaveLength(1);
  });

  it('attaches a consistent source-patch overlay to the page', () => {
    const zpl = '^XA^FO10,20^A0N,30,0^FDHello^FS^XZ';
    const result = importZplText(zpl, 8);
    const overlay = result.pages[0]?.overlay;
    expect(overlay).toBeDefined();
    // Segments rebuild the full block byte-for-byte.
    expect(overlay!.segments.map((s) => s.text).join('')).toBe(zpl);
    // The single field links to the one parsed object.
    const objId = result.pages[0]!.objects[0]!.id;
    expect(overlay!.segments.some((s) => s.kind === 'object' && s.objectId === objId)).toBe(true);
  });

});

describe('importZplText - driver dump (.prn)', () => {
  it("adopts the job block's persistent settings behind a settings-only block 0", () => {
    // Real ZDesigner anatomy: BOM, DLE control-prefix reset, binary junk,
    // settings block without ^PW/^LL, then the job block that has them.
    const dump =
      '\uFEFF\x10CT~~CD,~CC^~CT~\r\n\x1b##\x01\x00junk' +
      '^XA~JSN^LT0^MNW^JUS^XZ' +
      '^XA^MMT^PW831^LL406^LS0^FO50,50^GFA,8,8,1,FF00FF00FF00FF00^FS^PQ1^XZ';
    const r = importZplText(dump, 8);
    expect(r.labelConfig.widthMm).toBeCloseTo(831 / 8, 1);
    expect(r.labelConfig.heightMm).toBeCloseTo(406 / 8, 1);
    expect(r.labelConfig.mediaMode).toBe('T');
    expect(r.pages.some((p) => p.objects.some((o) => o.type === 'image'))).toBe(true);
  });
});

describe('importZplText - multi-label', () => {
  it('splits into one page per ^XA...^XZ block', () => {
    const zpl = [
      '^XA^FO10,20^A0N,30,0^FDOne^FS^XZ',
      '^XA^FO50,60^A0N,30,0^FDTwo^FS^XZ',
      '^XA^FO80,90^A0N,30,0^FDThree^FS^XZ',
    ].join('\n');
    const result = importZplText(zpl, 8);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]?.objects).toHaveLength(1);
    expect(result.pages[1]?.objects).toHaveLength(1);
    expect(result.pages[2]?.objects).toHaveLength(1);
  });

  it('uses the first block\'s label dimensions', () => {
    const zpl = [
      '^XA^PW800^LL400^FDOne^FS^XZ',
      '^XA^PW400^LL200^FDTwo^FS^XZ',
    ].join('\n');
    const result = importZplText(zpl, 8);
    expect(result.labelConfig.widthMm).toBe(100); // 800 dots / 8 dpmm
    expect(result.labelConfig.heightMm).toBe(50);
  });

  it('discards content before the first ^XA', () => {
    const zpl = 'garbage text before\n^XA^FDOne^FS^XZ';
    const result = importZplText(zpl, 8);
    expect(result.pages).toHaveLength(1);
  });

  it('handles mixed-case ^XA delimiters', () => {
    const zpl = '^xa^FDone^FS^xz\n^XA^FDtwo^FS^XZ';
    const result = importZplText(zpl, 8);
    expect(result.pages).toHaveLength(2);
  });

  it('flags and rejects a stream whose later block diverges in ^JM density', () => {
    const zpl = [
      '^XA^FO10,10^A0N,30,30^FDx^FS^XZ',
      '^XA^JMB^FO10,10^A0N,30,30^FDy^FS^XZ',
    ].join('\n');
    const result = importZplText(zpl, 8);
    expect(result.mixedPageGeometry).toBe(true);
    expect(result.report.findings).toContainEqual({ kind: 'mixedPageGeometry', command: '^JM', pageIndex: 1, cause: 'jm' });
    const finding = result.report.findings.find((f) => f.command === '^JM');
    expect(describeFinding(finding!, fallbackTranslations.importReport).title).toBe(
      'Density mode differs between blocks: later pages keep their own mode, but only the first is editable',
    );
  });

  it('lets a settings-only block 0 inherit a later block ^JM (no divergence)', () => {
    const zpl = ['^XA^MNY^XZ', '^XA^JMB^FO10,10^A0N,30,30^FDy^FS^XZ'].join('\n');
    const result = importZplText(zpl, 8);
    expect(result.mixedPageGeometry).toBe(false);
    expect(result.report.findings.some((f) => f.command === '^JM')).toBe(false);
    expect(result.labelConfig.jmDensity).toBe('B');
  });

  it('anchors on the first object block, not on a settings-only lead block', () => {
    const zpl = [
      '^XA^MNY^XZ',
      '^XA^FO10,10^GB50,50,2^FS^XZ',
      '^XA^JMB^FO10,10^GB50,50,2^FS^XZ',
    ].join('\n');
    const result = importZplText(zpl, 8);
    expect(result.labelConfig.jmDensity).toBeUndefined();
    expect(result.mixedPageGeometry).toBe(true);
    expect(result.report.findings).toContainEqual({ kind: 'mixedPageGeometry', command: '^JM', pageIndex: 2, cause: 'jm' });
  });

  it('treats a later ^JMA block as full density (no divergence from an unset first block)', () => {
    const zpl = [
      '^XA^FO10,10^A0N,30,30^FDx^FS^XZ',
      '^XA^JMA^FO10,10^A0N,30,30^FDy^FS^XZ',
    ].join('\n');
    const result = importZplText(zpl, 8);
    expect(result.mixedPageGeometry).toBe(false);
    expect(result.report.findings.some((f) => f.command === '^JM')).toBe(false);
  });
});

describe('importZplText - empty / malformed', () => {
  it('returns no pages when no ^XA is present', () => {
    const result = importZplText('not zpl at all', 8);
    expect(result.pages).toHaveLength(0);
  });

  it('returns an empty findings list with empty buckets', () => {
    const result = importZplText('not zpl at all', 8);
    expect(result.report.findings).toEqual([]);
    expect(result.report.partial).toEqual([]);
  });
});

describe('importZplText: findings.pageIndex', () => {
  it('stamps page 0 on findings from the first block', () => {
    const zpl = '^XA^FO0,0^A@N,30,0,E:A.TTF^FDx^FS^XZ';
    const { report } = importZplText(zpl, 8);
    const partial = report.findings.filter((f) => f.kind === 'partial');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.pageIndex).toBe(0);
  });

  it('stamps the correct page index across multiple blocks', () => {
    // Page 0: clean. Page 1: ^A@ partial. Page 2: ^IM browser-limit + ^XX unknown.
    const zpl = [
      '^XA^FO0,0^A0N,30,0^FDclean^FS^XZ',
      '^XA^FO0,0^A@N,30,0,E:A.TTF^FDfont^FS^XZ',
      '^XA^IMR:LOGO.GRF^XX99^XZ',
    ].join('\n');
    const { report } = importZplText(zpl, 8);
    const byPage = (idx: number) =>
      report.findings.filter((f) => f.pageIndex === idx).map((f) => f.kind);
    expect(byPage(0)).toEqual([]);
    expect(byPage(1)).toContain('partial');
    expect(byPage(2)).toContain('browserLimit');
    expect(byPage(2)).toContain('unknown');
  });

  it('per-page partial dedup is preserved (one partial per page even with two ^A@)', () => {
    // Inside page 1, ^A@ appears twice but is deduped per-block.
    const zpl = [
      '^XA^FO0,0^A0N,30,0^FDclean^FS^XZ',
      '^XA^FO0,0^A@N,30,0,E:A.TTF^FDa^FS^FO0,50^A@N,30,0,E:B.TTF^FDb^FS^XZ',
    ].join('\n');
    const { report } = importZplText(zpl, 8);
    const onPage1 = report.findings.filter(
      (f) => f.kind === 'partial' && f.pageIndex === 1,
    );
    expect(onPage1).toHaveLength(1);
    expect(onPage1[0]?.command).toBe('^A@');
  });

  it('folds printerProfile across multiple ^XA blocks (last-write-wins per key, non-overlapping preserved)', () => {
    // Block 1 sets reprintAfterError=N + setRealtimeClock; block 2 overrides
    // reprintAfterError. Both must survive: per-key last-write accumulation,
    // not last-block-wins.
    const zpl = [
      '^XA^JZN^ST05,20,2026,12,00,00^XZ',
      '^XA^JZY^XZ',
    ].join('\n');
    const { printerProfile } = importZplText(zpl, 8);
    expect(printerProfile.reprintAfterError).toBe('Y');
    expect(printerProfile.setRealtimeClock).toBeDefined();
  });
});

describe('importZplText - ~DY font scope (setup vs design)', () => {
  // Hex for bytes [01,02,03,04]; loadFontBytesSync caches without
  // validating, so any byte string decodes through the parser.
  const HEX = '01020304';

  it('routes a setup ~DY (no ^CW) before ^XA into printerProfile.setupFonts', () => {
    const zpl = `~DYE:SETUP,A,T,4,,${HEX}\n^XA^JZY^XZ`;
    const { printerProfile, pages } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:SETUP.TTF' }]);
    // The ^XA block still yields its (object-less) page.
    expect(pages).toHaveLength(1);
  });

  it('keeps the block objects while routing the preamble font to setupFonts', () => {
    const zpl =
      `~DYE:SETUP,A,T,4,,${HEX}\n` +
      `^XA^FO10,10^A0N,20,0^FDhi^FS^XZ`;
    const { printerProfile, pages } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:SETUP.TTF' }]);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.objects).toHaveLength(1);
  });

  it('parses a fonts-only stream with no ^XA: setupFonts set, no page', () => {
    const zpl = `~DYE:ONLY,A,T,4,,${HEX}`;
    const { printerProfile, pages } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:ONLY.TTF' }]);
    expect(pages).toHaveLength(0);
  });

  it('routes a design ~DY claimed by ^CW into customFonts, not setupFonts', () => {
    const zpl = `~DYE:DSGN,A,T,4,,${HEX}\n^XA^CWM,E:DSGN.TTF^XZ`;
    const { labelConfig, printerProfile } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toBeUndefined();
    expect(labelConfig.customFonts).toEqual([
      expect.objectContaining({ alias: 'M', path: 'E:DSGN.TTF', embedInZpl: true }),
    ]);
  });

  it('splits a mixed stream: ^CW-claimed is design, unclaimed is setup', () => {
    const zpl =
      `~DYE:DSGN,A,T,4,,${HEX}\n~DYE:SETUP,A,T,4,,${HEX}\n` +
      `^XA^CWM,E:DSGN.TTF^XZ`;
    const { labelConfig, printerProfile } = importZplText(zpl, 8);
    expect(labelConfig.customFonts?.map((m) => m.path)).toEqual(['E:DSGN.TTF']);
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:SETUP.TTF' }]);
  });

  it('treats a case-mismatched ^CW path as the same design font', () => {
    const zpl = `~DYE:DSGN,A,T,4,,${HEX}\n^XA^CWM,e:dsgn.ttf^XZ`;
    const { printerProfile } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toBeUndefined();
  });

  it('treats a ^A@ direct-path uploaded font (no ^CW) as a design font', () => {
    const zpl =
      `~DYE:DIRECT,A,T,4,,${HEX}\n` +
      `^XA^FO10,10^A@N,20,0,E:DIRECT.TTF^FDhi^FS^XZ`;
    const { printerProfile, pages } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toBeUndefined();
    expect(pages[0]?.objects).toHaveLength(1);
  });

  it('matches a driveless ^A@ ref against a drived ~DY upload by filename', () => {
    const zpl =
      `~DYE:FONT,A,T,4,,${HEX}\n` +
      `^XA^FO10,10^A@N,20,0,FONT.TTF^FDhi^FS^XZ`;
    const { printerProfile } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toBeUndefined();
  });

  it('keeps a drived ~DY upload as setup when only a different drive is referenced', () => {
    // R:FONT referenced but E:FONT uploaded: distinct drives are distinct
    // files, so the upload stays a setup font (no filename over-match).
    const zpl = `~DYE:FONT,A,T,4,,${HEX}\n^XA^FO0,0^A@N,20,0,R:FONT.TTF^FDx^FS^XZ`;
    const { printerProfile } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:FONT.TTF' }]);
  });

  it('excludes a ^CW-claimed font even when the ^CW sits in a later block', () => {
    const zpl = [
      `~DYE:LATE,A,T,${HEX.length / 2},,${HEX}\n^XA^FO0,0^A0N,20,0^FDa^FS^XZ`,
      `^XA^CWM,E:LATE.TTF^XZ`,
    ].join('\n');
    const { printerProfile } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toBeUndefined();
  });

  it('backfills embedInZpl on a driveless ^CW alias against a drived ~DY upload', () => {
    const zpl = `~DYE:DSGN,A,T,4,,${HEX}\n^XA^CWM,DSGN.TTF^XZ`;
    const { labelConfig, printerProfile } = importZplText(zpl, 8);
    expect(printerProfile.setupFonts).toBeUndefined();
    expect(labelConfig.customFonts).toEqual([
      expect.objectContaining({ alias: 'M', path: 'DSGN.TTF', embedInZpl: true, previewFontName: 'DSGN.TTF' }),
    ]);
  });

  it('cross-block ^CW backfills embedInZpl and previewFontName from the preamble upload', () => {
    const zpl = [
      `~DYE:LATE,A,T,${HEX.length / 2},,${HEX}\n^XA^FO0,0^A0N,20,0^FDa^FS^XZ`,
      `^XA^CWM,E:LATE.TTF^XZ`,
    ].join('\n');
    const { labelConfig } = importZplText(zpl, 8);
    expect(labelConfig.customFonts).toEqual([
      { alias: 'M', path: 'E:LATE.TTF', embedInZpl: true, previewFontName: 'LATE.TTF' },
    ]);
  });

  it('round-trips generateSetupScript setupFonts back into the profile', async () => {
    const { loadFontBytes } = await import('@zplab/core/lib/fontCache');
    await loadFontBytes(new Uint8Array([1, 2, 3, 4]), 'RTFONT.TTF');
    const script = generateSetupScript({
      setupFonts: [{ path: 'E:RTFONT.TTF' }],
    } as PrinterProfile);
    const { printerProfile } = importZplText(script, 8);
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:RTFONT.TTF' }]);
  });
});

describe('importZplText - cross-block variable merge (content markers)', () => {
  it('merges ^FN1 across blocks when the defaults agree', () => {
    const zpl =
      '^XA^FXField: GTIN^FO10,10^A0N,30,30^FN1^FDAlice^FS^XZ\n' +
      '^XA^FO10,10^A0N,30,30^FN1^FDAlice^FS^XZ';
    const r = importZplText(zpl, 8);
    expect(r.variables).toHaveLength(1);
    const name = r.variables[0]?.name;
    const p0 = r.pages[0]?.objects[0] as unknown as { props: { content: string } };
    const p1 = r.pages[1]?.objects[0] as unknown as { props: { content: string } };
    // Both pages reference the single kept variable by the same content marker.
    expect(p0.props.content).toBe(`«${name}»`);
    expect(p1.props.content).toBe(`«${name}»`);
  });

  it('keeps separate variables for a shared ^FN slot with divergent defaults', () => {
    // ^FN is scoped per ^XA format; merging Bob onto Alice would lose page 2's
    // default (regeneration would then emit page 1's). The second Variable
    // moves to the next free slot so fnNumber stays document-unique.
    const zpl =
      '^XA^FXField: GTIN^FO10,10^A0N,30,30^FN1^FDAlice^FS^XZ\n' +
      '^XA^FO10,10^A0N,30,30^FN1^FDBob^FS^XZ';
    const r = importZplText(zpl, 8);
    expect(r.variables).toHaveLength(2);
    expect(r.variables.map((v) => v.fnNumber)).toEqual([1, 2]);
    expect(r.variables.map((v) => v.defaultValue)).toEqual(['Alice', 'Bob']);
    const [v0, v1] = r.variables;
    expect(v0!.name).not.toBe(v1!.name);
    const p0 = r.pages[0]?.objects[0] as unknown as { props: { content: string } };
    const p1 = r.pages[1]?.objects[0] as unknown as { props: { content: string } };
    expect(p0.props.content).toBe(`«${v0!.name}»`);
    expect(p1.props.content).toBe(`«${v1!.name}»`);
  });

  it('renumbers around every source ^FN in the document (overlay bytes keep them)', () => {
    // Page 2's divergent ^FN1 must not land on fn 2: page 3's genuine ^FN2
    // stays in overlays/replay, so the renumbering skips to fn 3.
    const zpl =
      '^XA^FO10,10^A0N,30,30^FN1^FDa^FS^XZ\n' +
      '^XA^FO10,10^A0N,30,30^FN1^FDb^FS^XZ\n' +
      '^XA^FO10,10^A0N,30,30^FN2^FDz^FS^XZ';
    const r = importZplText(zpl, 8);
    expect(r.variables.map((v) => v.fnNumber)).toEqual([1, 3, 2]);
    expect(r.variables.map((v) => v.defaultValue)).toEqual(['a', 'b', 'z']);
    expect(r.report.findings.some((f) => f.kind === 'fnRenumbered')).toBe(true);
  });

  it('reserves lowercase source ^fn slots too (parser is case-insensitive)', () => {
    // A raw case-sensitive scan would miss ^fn2 and renumber page 2 onto it.
    const zpl =
      '^XA^FO10,10^A0N,30,30^FN1^FDa^FS^XZ\n' +
      '^XA^FO10,10^A0N,30,30^FN1^FDb^FS^XZ\n' +
      '^XA^FO10,10^A0N,30,30^fn2^FDz^FS^XZ';
    const r = importZplText(zpl, 8);
    expect(r.variables.map((v) => v.fnNumber)).toEqual([1, 3, 2]);
    expect(r.variables.map((v) => v.defaultValue)).toEqual(['a', 'b', 'z']);
  });

  it('treats an empty ^FD default as a bare declaration, not a divergent value', () => {
    // Declaration-first: the valued page backfills the shared Variable.
    const first = importZplText(
      '^XA^FO10,10^A0N,30,30^FN1^FD^FS^XZ\n^XA^FO10,10^A0N,30,30^FN1^FDAlice^FS^XZ',
      8,
    );
    expect(first.variables).toHaveLength(1);
    expect(first.variables[0]?.defaultValue).toBe('Alice');
    // Value-first: the bare declaration merges onto the valued Variable.
    const second = importZplText(
      '^XA^FO10,10^A0N,30,30^FN1^FDAlice^FS^XZ\n^XA^FO10,10^A0N,30,30^FN1^FD^FS^XZ',
      8,
    );
    expect(second.variables).toHaveLength(1);
    expect(second.variables[0]?.defaultValue).toBe('Alice');
  });

  it('renames the ^FX-hinted marker when a divergent slot renumbers (GTIN -> GTIN_2)', () => {
    const zpl =
      '^XA^FXField: GTIN^FO10,10^A0N,30,30^FN1^FDAlice^FS^XZ\n' +
      '^XA^FXField: GTIN^FO10,10^A0N,30,30^FN1^FDBob^FS^XZ';
    const r = importZplText(zpl, 8);
    expect(r.variables.map((v) => v.name)).toEqual(['GTIN', 'GTIN_2']);
    const p1 = r.pages[1]?.objects[0] as unknown as { props: { content: string } };
    expect(p1.props.content).toBe('«GTIN_2»');
  });

  it('falls back to the lossy merge with a finding when all 99 slots are taken', () => {
    // One block occupying every fn slot, then a divergent reuse of ^FN1.
    const fields = Array.from({ length: 99 }, (_, k) =>
      `^FO10,${10 + k}^A0N,10,10^FN${k + 1}^FDv${k + 1}^FS`,
    ).join('');
    const zpl = `^XA${fields}^XZ\n^XA^FO10,10^A0N,30,30^FN1^FDdivergent^FS^XZ`;
    const r = importZplText(zpl, 8);
    expect(r.variables).toHaveLength(99);
    // fn-unique invariant holds even in the exhaustion fallback.
    expect(new Set(r.variables.map((v) => v.fnNumber)).size).toBe(99);
    expect(r.report.findings.some((f) => f.kind === 'fnDefaultDropped')).toBe(true);
    // Page 2's marker is rewired onto the first page's Variable (lossy).
    const p1 = r.pages[1]?.objects[0] as unknown as { props: { content: string } };
    expect(p1.props.content).toBe(`«${r.variables[0]?.name}»`);
  });
});

describe('routeSetupCommands', () => {
  const HEX = '01020304';
  // Preamble setup font + ^ST + one object (page gets an overlay to strip).
  const STREAM =
    `~DYE:SETUP,A,T,4,,${HEX}\n` +
    `^XA^ST05,20,2026,12,00,00^FO10,10^A0N,20,0^FDhi^FS^XZ`;

  it('keep leaves profile and overlay untouched', () => {
    const imported = importZplText(STREAM, 8);
    expect(imported.pages[0]?.overlay).toBeDefined();
    const { printerProfile, pages } = routeSetupCommands('keep', imported);
    expect(printerProfile).toBe(imported.printerProfile);
    expect(pages).toBe(imported.pages);
    expect(printerProfile.setRealtimeClock).toBeDefined();
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:SETUP.TTF' }]);
  });

  it('setupScript keeps the profile but drops the overlay of replay-risk pages', () => {
    const imported = importZplText(STREAM, 8);
    const { printerProfile, pages } = routeSetupCommands('setupScript', imported);
    expect(printerProfile.setRealtimeClock).toBeDefined();
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:SETUP.TTF' }]);
    expect(pages[0]?.overlay).toBeUndefined();
    // Objects survive; only the byte-exact overlay is dropped.
    expect(pages[0]?.objects).toHaveLength(1);
  });

  it('remove strips the setup profile fields but keeps setupFonts and drops the overlay', () => {
    const imported = importZplText(STREAM, 8);
    const { printerProfile, pages } = routeSetupCommands('remove', imported);
    expect(printerProfile.setRealtimeClock).toBeUndefined();
    expect(printerProfile.setupFonts).toEqual([{ path: 'E:SETUP.TTF' }]);
    expect(pages[0]?.overlay).toBeUndefined();
    expect(pages[0]?.objects).toHaveLength(1);
  });

  it('remove yields an empty profile when there is no setup font', () => {
    const imported = importZplText('^XA^ST05,20,2026,12,00,00^FO10,10^A0N,20,0^FDhi^FS^XZ', 8);
    const { printerProfile } = routeSetupCommands('remove', imported);
    expect(printerProfile).toEqual({});
  });

  it('only strips the overlay of pages that carry a replay-risk command', () => {
    // Page 1 has ^ST (replay-risk), page 2 is clean.
    const zpl =
      `^XA^ST05,20,2026,12,00,00^FO10,10^A0N,20,0^FDp1^FS^XZ\n` +
      `^XA^FO10,10^A0N,20,0^FDp2^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(imported.pages[0]?.overlay).toBeDefined();
    expect(imported.pages[1]?.overlay).toBeDefined();
    const { pages } = routeSetupCommands('setupScript', imported);
    expect(pages[0]?.overlay).toBeUndefined();
    expect(pages[1]?.overlay).toBeDefined();
  });

  it('exports the setup command on keep but omits it on setupScript/remove', () => {
    const imported = importZplText(STREAM, 8);
    const label = { widthMm: 100, heightMm: 60, dpmm: 8, ...imported.labelConfig } as LabelConfig;
    const exportOf = (choice: Parameters<typeof routeSetupCommands>[0]) =>
      generateMultiPageZPL(label, routeSetupCommands(choice, imported).pages);
    // keep replays verbatim; the other two regenerate (never emits setup).
    expect(exportOf('keep')).toContain('^ST');
    expect(exportOf('setupScript')).not.toContain('^ST');
    expect(exportOf('remove')).not.toContain('^ST');
  });

  it('exports a mixed multi-page result cleanly (regenerated risk page + verbatim clean page)', () => {
    const zpl =
      `^XA^ST05,20,2026,12,00,00^FO10,10^A0N,20,0^FDp1^FS^XZ\n` +
      `^XA^FO10,10^A0N,20,0^FDp2^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const label = { widthMm: 100, heightMm: 60, dpmm: 8, ...imported.labelConfig } as LabelConfig;
    const out = generateMultiPageZPL(label, routeSetupCommands('setupScript', imported).pages);
    expect(out).not.toContain('^ST');
    expect(out).toContain('p1'); // regenerated risk page keeps its content
    expect(out).toContain('p2'); // clean page replays verbatim
    // Both label blocks survive the overlay/regen mix, none doubled or merged.
    expect(out.match(/\^XA/g)).toHaveLength(2);
    expect(out.match(/\^XZ/g)).toHaveLength(2);
  });
});

describe('raw binary payloads across import -> export', () => {
  it('re-emits a raw binary ^GFB text-safe instead of replaying raw bytes', () => {
    // A verbatim replay of the raw binary span would be corrupted by the
    // UTF-8 write-out; it must re-emit from the wrapped model bytes.
    const bin = String.fromCharCode(0x5e, 0x46, 0x53, 0x2c, 0x7e, 0x80, 0xff, 0x0a);
    const zpl = `^XA^FO0,0^GFB,8,8,1,${bin}^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const label = { widthMm: 100, heightMm: 60, dpmm: 8, ...imported.labelConfig } as LabelConfig;
    const out = generateMultiPageZPL(label, imported.pages);
    expect(out).toContain(':B64:');
    expect(/[^\t\n\r\x20-\x7E]/.test(out)).toBe(false);
  });
});

describe('byte-counted text-safe payloads across import -> export', () => {
  it('re-emits a LF-bearing byte-counted ^GFB wrapped instead of verbatim', () => {
    // The bytes survive our own write, but any CRLF-normalizing hop would
    // shift the count; the model cache is wrapped, the replay must use it.
    const bin = 'AB' + String.fromCharCode(10) + 'CD' + String.fromCharCode(10) + 'EF';
    const imported = importZplText(`^XA^FO0,0^GFB,8,8,1,${bin}^FS^XZ`, 8);
    const label = { widthMm: 100, heightMm: 60, dpmm: 8, ...imported.labelConfig } as LabelConfig;
    const out = generateMultiPageZPL(label, imported.pages);
    expect(out).toContain(':B64:');
  });

  it('replays untouched non-ASCII text segments verbatim (no false binary flag)', () => {
    // Non-ASCII is legitimate ^FD text; regenerating it would drop original
    // syntax like the ^CD remap alongside it.
    const src = '^XA^CD;^FO10;10^A0N;30;0^FDÄhre^FS^XZ';
    const imported = importZplText(src, 8);
    const label = { widthMm: 100, heightMm: 60, dpmm: 8, ...imported.labelConfig } as LabelConfig;
    const out = generateMultiPageZPL(label, imported.pages);
    expect(out).toContain('^CD;');
    expect(out).toContain('^FDÄhre');
  });

  it('keeps an orphan raw ~DY upload text-safe on export (no ^XG consumer)', () => {
    // No model object carries the upload; the raw segment itself must,
    // rewritten to the A + :B64: form instead of dropped by a full regen.
    const bin = String.fromCharCode(0x5e, 0x00, 0xff, 0x2c);
    const imported = importZplText(`^XA~DYR:ORPH,B,G,4,1,${bin}^FO10,10^A0N,20,0^FDx^FS^XZ`, 8);
    const label = { widthMm: 100, heightMm: 60, dpmm: 8, ...imported.labelConfig } as LabelConfig;
    const out = generateMultiPageZPL(label, imported.pages);
    expect(out).toContain('~DYR:ORPH,A,G,4,1,:B64:');
    expect(/[^\t\n\r\x20-\x7E]/.test(out)).toBe(false);
  });

  it('leaves a pasted non-latin1 payload verbatim instead of masking bytes', () => {
    // U+20AC has no byte truth left; a latin1 wrap would silently turn it
    // into 0xAC.
    const src = '^XA~DYR:EURO,B,G,4,1,€ABC^FO10,10^A0N,20,0^FDx^FS^XZ';
    const imported = importZplText(src, 8);
    const label = { widthMm: 100, heightMm: 60, dpmm: 8, ...imported.labelConfig } as LabelConfig;
    const out = generateMultiPageZPL(label, imported.pages);
    expect(out).toContain('~DYR:EURO,B,G,4,1,€ABC');
    expect(out).not.toContain(':B64:');
  });

  it('applies the wrap rule behind a ^CD delimiter remap too', () => {
    const bin = 'AB' + String.fromCharCode(10) + 'CD' + String.fromCharCode(10) + 'EF';
    const imported = importZplText(`^XA^CD;^FO0;0^GFB;8;8;1;${bin}^FS^XZ`, 8);
    const label = { widthMm: 100, heightMm: 60, dpmm: 8, ...imported.labelConfig } as LabelConfig;
    expect(generateMultiPageZPL(label, imported.pages)).toContain(':B64:');
  });
});

describe('replay-risk report helpers', () => {
  it('replayRiskFindings selects only the replayRisk kind', () => {
    const { report } = importZplText('^XA^KNfoo^FO0,0^A@N,20,0,E:A.TTF^FDx^FS^XZ', 8);
    // ^KN is replayRisk, ^A@ is a partial: only the former is selected.
    const risk = replayRiskFindings(report);
    expect(risk).toHaveLength(1);
    expect(risk[0]?.command).toBe('^KN');
  });

  it('resolveRoutedReport drops the replayRisk findings and bucket, keeps the rest', () => {
    const { report } = importZplText('^XA^KNfoo^FO0,0^A@N,20,0,E:A.TTF^FDx^FS^XZ', 8);
    expect(report.replayRisk).toContain('^KN');
    const stripped = resolveRoutedReport(report, [0]);
    expect(stripped.replayRisk).toEqual([]);
    expect(stripped.findings.some((f) => f.kind === 'replayRisk')).toBe(false);
    // The unrelated partial finding survives.
    expect(stripped.findings.some((f) => f.kind === 'partial')).toBe(true);
    expect(stripped.partial).toEqual(report.partial);
  });

  it('resolveRoutedReport clears a deviceAction finding on a routed (overlay-dropped) page', () => {
    // ^ST and ~JC share page 0; the overlay drop moots the device action too.
    const { report } = importZplText('^XA^ST05,20,2026,12,00,00~JC^FO10,10^A0N,20,0^FDx^FS^XZ', 8);
    expect(report.deviceAction).toContain('~JC');
    const stripped = resolveRoutedReport(report, [0]);
    expect(stripped.deviceAction).toEqual([]);
    expect(stripped.findings.some((f) => f.kind === 'deviceAction')).toBe(false);
  });

  it('resolveRoutedReport keeps a deviceAction finding on a page that was not routed', () => {
    // Page 1's device action keeps its overlay, so its warning survives.
    const zpl =
      '^XA^ST05,20,2026,12,00,00^FO10,10^A0N,20,0^FDp1^FS^XZ\n' +
      '^XA~JC^FO10,10^A0N,20,0^FDp2^FS^XZ';
    const { report } = importZplText(zpl, 8);
    const stripped = resolveRoutedReport(report, [0, 1]);
    expect(stripped.deviceAction).toContain('~JC');
  });

  it('drops findings on a removed page and remaps survivors to the new index', () => {
    // Page 0 (setup-only, ^IM finding) is routed away; page 1 has an ^A@ partial.
    const zpl =
      '^XA^ST05,20,2026,12,00,00^IMR:LOGO.GRF^XZ\n' +
      '^XA^FO0,0^A@N,20,0,E:A.TTF^FDx^FS^XZ';
    const imported = importZplText(zpl, 8);
    const { pages, keptPageIndexes } = routeSetupCommands('remove', imported);
    expect(pages).toHaveLength(1); // the setup-only page 0 is dropped
    expect(keptPageIndexes).toEqual([1]);
    const stripped = resolveRoutedReport(imported.report, keptPageIndexes);
    // The removed page's ^IM finding is gone; the survivor is remapped to page 0.
    expect(stripped.browserLimit).toEqual([]);
    expect(stripped.findings.some((f) => f.kind === 'browserLimit')).toBe(false);
    const partial = stripped.findings.filter((f) => f.kind === 'partial');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.pageIndex).toBe(0);
  });
});

describe('printerCommandFindings', () => {
  it('returns replayRisk and deviceAction findings together', () => {
    const { report } = importZplText('^XA^KNfoo~JC^FO10,10^A0N,20,0^FDx^FS^XZ', 8);
    const kinds = printerCommandFindings(report).map((f) => f.kind).sort();
    expect(kinds).toEqual(['deviceAction', 'replayRisk']);
  });
});

describe('mergeSetupFonts', () => {
  it('unions incoming onto existing, deduped by normalized path', () => {
    const existing = [{ path: 'E:OLD.TTF' }, { path: 'E:SHARED.TTF' }];
    const incoming = [{ path: 'e:shared.ttf' }, { path: 'E:NEW.TTF' }];
    expect(mergeSetupFonts(existing, incoming)).toEqual([
      { path: 'E:OLD.TTF' },
      { path: 'E:SHARED.TTF' },
      { path: 'E:NEW.TTF' },
    ]);
  });

  it('returns the incoming set when there is no existing profile', () => {
    expect(mergeSetupFonts(undefined, [{ path: 'E:A.TTF' }])).toEqual([{ path: 'E:A.TTF' }]);
  });
});

describe('routeSetupCommands - setup-only pages', () => {
  it('drops a setup-only block to no page on remove/setupScript', () => {
    const imported = importZplText('^XA^ST05,20,2026,12,00,00^XZ', 8);
    expect(imported.pages).toHaveLength(1); // the empty block is a page pre-routing
    const setupScript = routeSetupCommands('setupScript', imported);
    expect(setupScript.pages).toHaveLength(0);
    expect(setupScript.keptPageIndexes).toEqual([]);
    expect(routeSetupCommands('remove', imported).pages).toHaveLength(0);
  });

  it('keeps a real page and drops only the setup-only block in a mixed import', () => {
    const zpl =
      '^XA^FO10,10^A0N,20,0^FDreal^FS^XZ\n' +
      '^XA^ST05,20,2026,12,00,00^XZ';
    const imported = importZplText(zpl, 8);
    const { pages, keptPageIndexes } = routeSetupCommands('remove', imported);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.objects).toHaveLength(1);
    expect(keptPageIndexes).toEqual([0]); // page 1 (setup-only) dropped
  });

  it('keeps the setup-only block as a page on keep (overlay round-trips it)', () => {
    const imported = importZplText('^XA^ST05,20,2026,12,00,00^XZ', 8);
    const { pages, keptPageIndexes } = routeSetupCommands('keep', imported);
    expect(pages).toHaveLength(1);
    expect(keptPageIndexes).toEqual([0]);
  });

  it('flags divergent ^PW/^LL between blocks as mixedPageGeometry', () => {
    const imported = importZplText('^XA^PW400^LL200^FO10,10^FDA^FS^XZ^XA^PW800^LL400^FO10,10^FDB^FS^XZ', 8);
    expect(imported.mixedPageGeometry).toBe(true);
    const finding = imported.report.findings.find((f) => f.kind === 'mixedPageGeometry');
    expect(finding).toBeDefined();
    expect(describeFinding(finding!, fallbackTranslations.importReport).title).toMatch(/Multiple label sizes/);
  });

  it('does not flag a shared explicit size (^PW/^LL persist across ^XA)', () => {
    const imported = importZplText('^XA^PW800^LL400^FO10,10^FDA^FS^XZ^XA^FO10,10^FDB^FS^XZ', 8);
    expect(imported.mixedPageGeometry).toBe(false);
  });
});
