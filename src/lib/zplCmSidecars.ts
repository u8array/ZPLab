import { EditorState, RangeSet, RangeValue, StateField, type Extension, type Range, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { countBefore } from '@zplab/core/lib/sortedCount';
import { sidecarRanges, stripSidecarComments } from '@zplab/core/lib/zplLabelMeta';

class Atomic extends RangeValue {}
const ATOMIC = new Atomic();

interface Hidden {
  deco: DecorationSet;
  /** Each hidden range extended one position left, so the caret cannot rest just before it. */
  atomic: RangeSet<Atomic>;
  /** Positions of the line breaks inside hidden ranges, ascending: what the gutter must not count. */
  breaks: number[];
}

// Positions in a doc slice equal doc positions: CM counts every line break as one.
function scan(state: EditorState, from: number, to: number): Range<Decoration>[] {
  const doc = state.doc;
  return sidecarRanges(doc.sliceString(from, to)).map((r) => {
    const start = from + r.start;
    const end = from + r.end;
    const wholeLine = doc.lineAt(start).from === start && (end === doc.length || doc.lineAt(end).from === end);
    return Decoration.replace(wholeLine ? { block: true } : {}).range(start, end);
  });
}

function derive(state: EditorState, deco: DecorationSet): Hidden {
  const ranges: Range<Atomic>[] = [];
  const breaks: number[] = [];
  deco.between(0, state.doc.length, (from, to) => {
    ranges.push(ATOMIC.range(Math.max(0, from - 1), to));
    for (let i = state.doc.lineAt(from).to; i < to; i = state.doc.lineAt(i + 1).to) breaks.push(i);
  });
  return { deco, atomic: RangeSet.of(ranges, true), breaks };
}

// The window grows to whole lines until no hidden range crosses its edge, so every range it
// drops is rescanned in full; a sidecar can span lines (its body admits breaks).
function rescan(deco: DecorationSet, tr: Transaction): DecorationSet {
  const doc = tr.state.doc;
  const nextLineStart = (pos: number) => Math.min(doc.lineAt(pos).to + 1, doc.length);
  let mapped = deco.map(tr.changes);
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    let from = doc.lineAt(fromB).from;
    let to = nextLineStart(toB);
    for (let grew = true; grew; ) {
      grew = false;
      mapped.between(from, to, (f, t) => {
        const lo = doc.lineAt(f).from;
        const hi = nextLineStart(t);
        if (lo < from || hi > to) {
          from = Math.min(from, lo);
          to = Math.max(to, hi);
          grew = true;
        }
      });
    }
    mapped = mapped.update({ filterFrom: from, filterTo: to, filter: (f, t) => !(f < to && t > from) });
    mapped = mapped.update({ add: scan(tr.state, from, to) });
  });
  return mapped;
}

const hidden = StateField.define<Hidden>({
  create: (state) => derive(state, Decoration.set(scan(state, 0, state.doc.length))),
  update: (value, tr) => (tr.docChanged ? derive(tr.state, rescan(value.deco, tr)) : value),
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// A caret deletion reaching hidden bytes, or the break before them, is dropped whole: joining two
// visible lines across a hidden one has no right answer, so it takes a selection.
function keepsHiddenBytes(tr: Transaction): boolean {
  if (!tr.docChanged || !tr.isUserEvent('delete') || !tr.startState.selection.main.empty) return true;
  const atomic = tr.startState.field(hidden).atomic;
  let touches = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    atomic.between(fromA, toA, (from, to) => {
      if (fromA < to && toA > from) touches = true;
    });
  });
  return !touches;
}

/** Visible-line number for gutter `n`, so the pane numbers the bytes it shows. */
export function visibleLineNumber(state: EditorState, n: number): number {
  const value = state.field(hidden, false);
  // The gutter also formats its width spacer, a number past the last line.
  if (!value || n > state.doc.lines) return n;
  return n - countBefore(value.breaks, state.doc.line(n).from);
}

/** With metadata off, the pane shows, copies and numbers the bytes the export carries; the
 *  buffer keeps the sidecars, so baseline, spans, linter and apply stay whole. */
export const hideSidecarsExt = (hide: boolean): Extension =>
  hide
    ? [
        hidden,
        EditorView.atomicRanges.of((v) => v.state.field(hidden).atomic),
        EditorState.transactionFilter.of((tr) => (keepsHiddenBytes(tr) ? tr : [])),
        EditorView.clipboardOutputFilter.of((text) => stripSidecarComments(text)),
      ]
    : [];
