import { describe, it, expect } from 'vitest';
import { getObjectStringContent } from '@zplab/core/lib/variableBinding';
import { findingsOf, parseSingle } from '../test/helpers';

// ZD230-measured (2026-09-14): `^FH` followed by a line break still decodes the next ^FD with
// the default underscore. The break is not the hex indicator.
describe('parseZPL — ^FH on its own line', () => {
  it('keeps the default delimiter, so the data decodes and its control byte is flagged', () => {
    const r = parseSingle('^XA^PW800^LL1200\n^FO40,40\n^A0N,60,60\n^FH\n^FDal_0Apha\n^FS\n^XZ', 8);
    expect(r.objects.map(getObjectStringContent)).toEqual(['al\npha']);
    expect(findingsOf(r, 'hexControl').map((f) => f.command)).toEqual(['_0A']);
  });

  it('still takes an explicit indicator on the same line', () => {
    const r = parseSingle('^XA^PW800^LL1200^FO40,40^A0N,60,60^FH#\n^FDa#41b^FS^XZ', 8);
    expect(r.objects.map(getObjectStringContent)).toEqual(['aAb']);
  });
});
