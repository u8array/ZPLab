import { describe, it, expect } from 'vitest';
import {
  resolveVariableValue,
  buildActiveRow,
  activeCellValue,
  applyBindingToObject,
  applyBindingToTree,
  getVariableSource,
  shouldShowFallbackTint,
  resolveContentPreview,
  type ActiveRow,
} from '@zplab/core/lib/variableBinding';
import { objectResolvesCtrl } from '@zplab/core/registry';
import type { ColumnMapping, Variable } from '@zplab/core/types/Variable';
import type { LabelObject } from '@zplab/core/types/Group';

const variable = (over: Partial<Variable> = {}): Variable => ({
  id: 'v1',
  name: 'sku',
  fnNumber: 1,
  defaultValue: 'DEFAULT',
  ...over,
});

const mapping = (bindings: Record<string, string> = {}): ColumnMapping => ({
  bindings,
  headerSnapshot: [],
});

const active = (
  headers: string[],
  row: string[],
  bindings: Record<string, string>,
): ActiveRow => ({ headers, row, mapping: mapping(bindings) });

describe('resolveVariableValue', () => {
  it('returns defaultValue when no active row', () => {
    expect(resolveVariableValue(variable(), null)).toBe('DEFAULT');
  });

  it('returns defaultValue when variable is not bound', () => {
    expect(
      resolveVariableValue(variable(), active(['sku'], ['A1'], { other: 'sku' })),
    ).toBe('DEFAULT');
  });

  it('returns the bound cell value when header exists', () => {
    expect(
      resolveVariableValue(
        variable(),
        active(['sku', 'qty'], ['A1', '10'], { v1: 'sku' }),
      ),
    ).toBe('A1');
  });

  it('returns defaultValue when bound header is missing from headers', () => {
    expect(
      resolveVariableValue(
        variable(),
        active(['qty'], ['10'], { v1: 'sku' }),
      ),
    ).toBe('DEFAULT');
  });

  it('returns empty string for an empty cell (no fallback to default)', () => {
    expect(
      resolveVariableValue(
        variable(),
        active(['sku'], [''], { v1: 'sku' }),
      ),
    ).toBe('');
  });

  it('returns empty string when row is shorter than headers', () => {
    expect(
      resolveVariableValue(
        variable(),
        active(['sku', 'qty'], ['A1'], { v1: 'qty' }),
      ),
    ).toBe('');
  });

  it('schema mode returns «name» regardless of CSV state', () => {
    expect(resolveVariableValue(variable({ name: 'sku' }), null, 'schema')).toBe('«sku»');
    expect(
      resolveVariableValue(
        variable({ name: 'sku' }),
        active(['sku'], ['A1'], { v1: 'sku' }),
        'schema',
      ),
    ).toBe('«sku»');
  });
});

describe('buildActiveRow', () => {
  it('returns null when dataset is null', () => {
    expect(buildActiveRow(null, mapping())).toBeNull();
  });

  it('returns null when mapping is null', () => {
    expect(
      buildActiveRow(
        { headers: ['sku'], rows: [['A1']], activeRowIndex: 0 },
        null,
      ),
    ).toBeNull();
  });

  it('returns null when activeRowIndex is out of bounds', () => {
    expect(
      buildActiveRow(
        { headers: ['sku'], rows: [], activeRowIndex: 0 },
        mapping(),
      ),
    ).toBeNull();
  });

  it('assembles row when dataset, mapping and index align', () => {
    const result = buildActiveRow(
      { headers: ['sku', 'qty'], rows: [['A1', '10'], ['B2', '5']], activeRowIndex: 1 },
      mapping({ v1: 'sku' }),
    );
    expect(result).toEqual({
      headers: ['sku', 'qty'],
      row: ['B2', '5'],
      mapping: mapping({ v1: 'sku' }),
    });
  });
});

describe('activeCellValue', () => {
  it('returns undefined when there is no active row', () => {
    expect(activeCellValue(variable(), null)).toBeUndefined();
  });

  it('returns undefined when the variable is unbound', () => {
    expect(
      activeCellValue(variable(), active(['sku'], ['A1'], { other: 'sku' })),
    ).toBeUndefined();
  });

  it('returns undefined when the bound header is missing (stale mapping)', () => {
    expect(
      activeCellValue(variable(), active(['qty'], ['10'], { v1: 'sku' })),
    ).toBeUndefined();
  });

  it('returns the bound cell value', () => {
    expect(
      activeCellValue(variable(), active(['sku'], ['A1'], { v1: 'sku' })),
    ).toBe('A1');
  });

  it('returns "" for an empty cell (no default fold-in)', () => {
    expect(
      activeCellValue(variable(), active(['sku'], [''], { v1: 'sku' })),
    ).toBe('');
  });

  it('returns "" when the row is shorter than headers', () => {
    expect(
      activeCellValue(variable(), active(['sku', 'qty'], ['A1'], { v1: 'qty' })),
    ).toBe('');
  });

  // Whitespace is a genuine print value, kept verbatim; the empty/whitespace
  // fallback split is the placeholder's, not this helper's.
  it('returns a whitespace-only cell verbatim', () => {
    expect(
      activeCellValue(variable(), active(['sku'], ['  '], { v1: 'sku' })),
    ).toBe('  ');
  });
});

describe('applyBindingToObject', () => {
  const obj = (content = 'orig'): LabelObject =>
    ({
      id: 'o1',
      type: 'text',
      x: 0,
      y: 0,
      rotation: 0,
      props: { content },
    }) as unknown as LabelObject;

  it('returns identity for plain literal content (no markers)', () => {
    const o = obj();
    expect(applyBindingToObject(o, [variable()])).toBe(o);
  });

  it('resolves control chips only when the caller grants emitter parity (ctrlOk)', () => {
    const chip = (type: string, extra: object = {}): LabelObject =>
      ({ id: 'c1', type, x: 0, y: 0, rotation: 0, props: { content: 'A«ctrl:TAB»B', ...extra } }) as unknown as LabelObject;
    const content = (o: LabelObject) => (o as unknown as { props: { content: string } }).props.content;
    expect(content(applyBindingToObject(chip('code128'), [], null, 'preview', undefined, true))).toBe('A\tB');
    // Default (and explicit false) keeps the chip literal, like export on
    // incapable types; identity preserved.
    const e = chip('ean13');
    expect(applyBindingToObject(e, [])).toBe(e);
    const g = chip('code128', { gs1: true });
    expect(applyBindingToObject(g, [], null, 'preview', undefined, false)).toBe(g);
  });

  it('resolveContentPreview keeps chips literal on request (GS1 builder parity)', () => {
    expect(resolveContentPreview('A«ctrl:GS»B', [])).toBe('A\x1DB');
    expect(resolveContentPreview('A«ctrl:GS»B', [], undefined, { resolveCtrl: false })).toBe('A«ctrl:GS»B');
  });

  it('objectResolvesCtrl mirrors the emitter gate (capability + non-GS1)', () => {
    const o = (type: string, props: object = {}) => ({ type, props });
    expect(objectResolvesCtrl(o('code128'))).toBe(true);
    expect(objectResolvesCtrl(o('qrcode'))).toBe(true);
    expect(objectResolvesCtrl(o('code128', { gs1: true }))).toBe(false);
    expect(objectResolvesCtrl(o('datamatrix', { gs1: true }))).toBe(false);
    expect(objectResolvesCtrl(o('ean13'))).toBe(false);
    expect(objectResolvesCtrl(o('text'))).toBe(false);
  });

  it('substitutes a single marker default when no active row', () => {
    const o = obj('«sku»');
    const out = applyBindingToObject(o, [variable()]);
    expect((out as unknown as { props: { content: string } }).props.content).toBe(
      'DEFAULT',
    );
  });

  it('substitutes CSV cell when the marker variable is mapped and a row is active', () => {
    const o = obj('«sku»');
    const out = applyBindingToObject(
      o,
      [variable()],
      active(['sku'], ['A1'], { v1: 'sku' }),
    );
    expect((out as unknown as { props: { content: string } }).props.content).toBe(
      'A1',
    );
  });

  it('returns identity when content is plain (nothing to resolve)', () => {
    const o = obj('DEFAULT');
    expect(applyBindingToObject(o, [variable()])).toBe(o);
  });

  it('resolves one pass only: a marker whose default holds a marker stays literal (matches export)', () => {
    // content «outer»; outer's default literally contains «inner». The exporter
    // emits the default verbatim (no recursion), so preview must too.
    const outer = variable({ id: 'v1', name: 'outer', defaultValue: '«inner»' });
    const inner = variable({ id: 'v2', name: 'inner', defaultValue: 'X' });
    const out = applyBindingToObject(obj('«outer»'), [outer, inner]);
    expect((out as unknown as { props: { content: string } }).props.content).toBe('«inner»');
  });

  it('resolves markers in a multi-token template field', () => {
    const v = variable({ id: 'v2', name: 'inner', defaultValue: 'X' });
    const out = applyBindingToObject(obj('a«inner»b'), [v]);
    expect((out as unknown as { props: { content: string } }).props.content).toBe('aXb');
  });

  it("resolves the field's own clock marker in preview", () => {
    const out = applyBindingToObject(obj('«clock:Y»'), []);
    expect((out as unknown as { props: { content: string } }).props.content).toMatch(/^\d{4}$/);
  });

  it('keeps a clock marker that arrived via a variable value literal (matches export)', () => {
    // sku's CSV cell literally contains «clock:Y»; export writes substituted data
    // verbatim (no ^FC inside it), so preview must keep it literal, not resolve it.
    const out = applyBindingToObject(
      obj('«sku»'),
      [variable()],
      active(['sku'], ['«clock:Y»'], { v1: 'sku' }),
    );
    expect((out as unknown as { props: { content: string } }).props.content).toBe('«clock:Y»');
  });
});

describe('getVariableSource', () => {
  const v = variable();
  const datasetWith = (headers: string[]) => ({ headers });

  it("returns 'default' when no mapping exists", () => {
    expect(getVariableSource(v, datasetWith(['sku']), null)).toBe('default');
  });

  it("returns 'default' when variable is not in mapping bindings", () => {
    expect(
      getVariableSource(v, datasetWith(['sku']), { bindings: {}, headerSnapshot: ['sku'] }),
    ).toBe('default');
  });

  it("returns 'default' when bound but no dataset is loaded", () => {
    expect(
      getVariableSource(v, null, { bindings: { v1: 'sku' }, headerSnapshot: ['sku'] }),
    ).toBe('default');
  });

  it("returns 'bound' when bound and the header exists in the dataset", () => {
    expect(
      getVariableSource(v, datasetWith(['sku', 'qty']), {
        bindings: { v1: 'sku' },
        headerSnapshot: ['sku', 'qty'],
      }),
    ).toBe('bound');
  });

  it("returns 'orphan' when bound but header is missing from current dataset", () => {
    expect(
      getVariableSource(v, datasetWith(['qty']), {
        bindings: { v1: 'sku' },
        headerSnapshot: ['sku', 'qty'],
      }),
    ).toBe('orphan');
  });
});

describe('applyBindingToTree', () => {
  const leaf = (id: string, content = 'orig'): LabelObject =>
    ({
      id,
      type: 'text',
      x: 0,
      y: 0,
      rotation: 0,
      props: { content },
    }) as unknown as LabelObject;

  const group = (id: string, children: LabelObject[]): LabelObject =>
    ({
      id,
      type: 'group',
      x: 0,
      y: 0,
      rotation: 0,
      children,
    }) as unknown as LabelObject;

  it('substitutes top-level leaves', () => {
    const objs = [leaf('a'), leaf('b', '«sku»')];
    const out = applyBindingToTree(objs, [variable()], null);
    expect((out[1] as unknown as { props: { content: string } }).props.content).toBe('DEFAULT');
  });

  it('recurses into group children', () => {
    const objs = [group('g1', [leaf('a', '«sku»'), leaf('b')])];
    const out = applyBindingToTree(objs, [variable()], null);
    const g = out[0]! as unknown as { children: { props: { content: string } }[] };
    expect(g.children[0]!.props.content).toBe('DEFAULT');
    expect(g.children[1]!.props.content).toBe('orig');
  });

  it('substitutes from active CSV row', () => {
    const objs = [leaf('a', '«sku»')];
    const out = applyBindingToTree(
      objs,
      [variable()],
      active(['sku'], ['ROW-VALUE'], { v1: 'sku' }),
    );
    expect((out[0] as unknown as { props: { content: string } }).props.content).toBe('ROW-VALUE');
  });

  it('schema mode replaces with «name» across tree', () => {
    const objs = [group('g1', [leaf('a', '«sku»')])];
    const out = applyBindingToTree(objs, [variable({ name: 'sku' })], null, 'schema');
    const g = out[0]! as unknown as { children: { props: { content: string } }[] };
    expect(g.children[0]!.props.content).toBe('«sku»');
  });
});

describe('shouldShowFallbackTint', () => {
  const v = variable();
  const ds = (headers: string[]) => ({ headers });
  const map = (bindings: Record<string, string>): ColumnMapping => ({
    bindings, headerSnapshot: [],
  });

  it('returns false in schema mode regardless of state', () => {
    expect(shouldShowFallbackTint(v, ds(['x']), map({ v1: 'x' }), 'schema')).toBe(false);
  });

  it('returns false when no CSV is loaded', () => {
    expect(shouldShowFallbackTint(v, null, map({ v1: 'x' }), 'preview')).toBe(false);
  });

  it('returns false when no variable is given (unbound)', () => {
    expect(shouldShowFallbackTint(undefined, ds(['x']), map({}), 'preview')).toBe(false);
  });

  it('returns false when bound + header exists (csv source)', () => {
    expect(shouldShowFallbackTint(v, ds(['sku']), map({ v1: 'sku' }), 'preview')).toBe(false);
  });

  it('returns true when bound + header missing (orphan source)', () => {
    expect(shouldShowFallbackTint(v, ds(['qty']), map({ v1: 'sku' }), 'preview')).toBe(true);
  });

  it('returns true when unbound + CSV loaded (default source)', () => {
    expect(shouldShowFallbackTint(v, ds(['sku']), map({}), 'preview')).toBe(true);
  });
});

describe('resolveContentPreview', () => {
  const vars: Variable[] = [
    { id: 'a', name: 'sku', fnNumber: 1, defaultValue: '12345' },
  ];
  it('substitutes variable defaults and leaves unknown markers literal', () => {
    expect(resolveContentPreview('x«sku»y', vars)).toBe('x12345y');
    expect(resolveContentPreview('«ghost»', vars)).toBe('«ghost»');
    expect(resolveContentPreview('plain', vars)).toBe('plain');
  });
  it('resolves clock markers to fixed-width fields', () => {
    const out = resolveContentPreview('«clock:Y»«clock:m»«clock:d»', []);
    expect(out).toMatch(/^\d{8}$/);
  });
  it('honors a channel offset ctx (clock2/clock3 shift vs unshifted)', () => {
    const shifted = resolveContentPreview('«clock2:Y»', [], {
      secondaryOffset: { years: 1, months: 0, days: 0, hours: 0, minutes: 0 },
      tertiaryOffset: undefined,
    });
    const plain = resolveContentPreview('«clock:Y»', []);
    expect(Number(shifted)).toBe(Number(plain) + 1);
  });
});
