import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  keymap,
  lineNumbers,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { Annotation, Compartment, EditorState, RangeSetBuilder, Transaction, type StateEffect } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { codeFolding, foldService, foldGutter, foldKeymap, foldEffect, foldedRanges } from '@codemirror/language';
import { setDiagnostics, diagnosticCount, forEachDiagnostic, type Diagnostic } from '@codemirror/lint';
import type { SourceLint } from '../../lib/sourceDiagnostics';
import { zplLineHighlights, opaquePayloadFold, isPureCrlf } from '../../lib/zplCmHighlight';
import { MAX_LINE_RENDER } from '../../lib/zplTokenStyles';

// Text.toString() always joins with LF; only sliceString honours the
// lineSeparator facet, and the store buffer must get the original separators.
const docText = (state: EditorState): string =>
  state.doc.sliceString(0, state.doc.length, state.lineBreak);

// Marks prop-sync dispatches: they must not echo through onChange (which
// would start an edit session) nor land in the undo history.
const propSync = Annotation.define<boolean>();

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // A folded payload splits its line across two visible ranges; decorate each
  // line once or the builder rejects the duplicate ranges.
  let lastLine = -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.number !== lastLine) {
        lastLine = line.number;
        for (const r of zplLineHighlights(line.text, line.from)) {
          builder.add(r.from, r.to, Decoration.mark({ class: r.cls }));
        }
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const zplHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const zplFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  return opaquePayloadFold(line.text, line.from);
});

function isFolded(state: EditorState, from: number, to: number): boolean {
  let hit = false;
  foldedRanges(state).between(from, to, (f, t) => {
    if (f === from && t === to) hit = true;
  });
  return hit;
}

function blobFoldEffects(state: EditorState, from: number, to: number): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [];
  let pos = from;
  const end = Math.min(to, state.doc.length);
  while (pos <= end) {
    const line = state.doc.lineAt(pos);
    const fold = line.length > MAX_LINE_RENDER ? opaquePayloadFold(line.text, line.from) : null;
    if (fold && !isFolded(state, fold.from, fold.to)) effects.push(foldEffect.of(fold));
    pos = line.to + 1;
  }
  return effects;
}

/** Folds for blobs a change just made foldable: only lines not already overlong
 *  before it, so typing inside a deliberately unfolded blob never re-folds it. */
function foldsForInsertedBlobs(u: ViewUpdate): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [];
  u.changes.iterChanges((fromA, toA, fromB, toB) => {
    let posA = fromA;
    const endA = Math.min(toA, u.startState.doc.length);
    while (posA <= endA) {
      const line = u.startState.doc.lineAt(posA);
      if (line.length > MAX_LINE_RENDER) return;
      posA = line.to + 1;
    }
    effects.push(...blobFoldEffects(u.state, fromB, toB));
  });
  return effects;
}

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', fontSize: '12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.625' },
  '.cm-content': { caretColor: 'currentColor', padding: '8px 0' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'inherit', opacity: '0.4' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-zplSelectedLine': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
  },
  // CM's base theme paints the tooltip for a light host (no `dark` declared
  // here), and the pane itself is surface-2: without the app's token plus
  // elevation the popup reads as text pasted onto the code.
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.35)',
    color: 'var(--color-text)',
  },
  '.cm-diagnostic': { color: 'var(--color-text)' },
});

/** Whether the editor already shows exactly these marks, in this order. */
function sameDiagnostics(state: EditorState, next: readonly Diagnostic[]): boolean {
  let i = 0;
  let same = true;
  forEachDiagnostic(state, (d, from, to) => {
    const n = next[i++];
    if (!n || n.from !== from || n.to !== to || n.severity !== d.severity || n.message !== d.message) {
      same = false;
    }
  });
  return same && i === next.length;
}

function highlightDecorations(state: EditorState, lines: ReadonlySet<number>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const idx of [...lines].sort((a, b) => a - b)) {
    if (idx < 0 || idx >= state.doc.lines) continue;
    builder.add(
      state.doc.line(idx + 1).from,
      state.doc.line(idx + 1).from,
      Decoration.line({ class: 'cm-zplSelectedLine' }),
    );
  }
  return builder.finish();
}

const NO_LINES: ReadonlySet<number> = new Set();

/** Total map, so a new semantic severity cannot silently render as a hint. */
const CM_SEVERITY: Record<SourceLint['severity'], 'error' | 'hint'> = {
  error: 'error',
  related: 'hint',
};

// Compartment payloads built in ONE place each, so mount and reconfigure
// cannot silently drift apart.
const readOnlyExt = (ro: boolean) => [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];
const highlightExt = (lines: ReadonlySet<number>) =>
  EditorView.decorations.of((v) => highlightDecorations(v.state, lines));
// One compartment: both are locale strings that change on the same event.
const localeExt = (ariaLabel: string, placeholderText: string) => [
  EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
  placeholder(placeholderText),
];

export interface ZplCodeMirrorHandle {
  focus(): void;
}

/** CodeMirror host for the source pane: shared-tokenizer colouring, auto-folded
 *  payload blobs. A bare \r has no CM representation, so the first edit
 *  normalizes it to \n; an untouched buffer stays byte-identical. */
export default function ZplCodeMirror({
  value,
  onChange,
  ariaLabel,
  placeholderText,
  readOnly = false,
  highlightLines = NO_LINES,
  historyEpoch = 0,
  diagnostics = null,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  /** Shown while the doc is empty (authoring a label from scratch). */
  placeholderText: string;
  readOnly?: boolean;
  /** 0-based doc lines tinted as the canvas selection's emitted source. */
  highlightLines?: ReadonlySet<number>;
  /** Bumping clears the undo history (minimal-splice syncs keep old events
   *  mappable, so without this an undo could resurrect a closed session). */
  historyEpoch?: number;
  /** Framework-neutral lints in STRING offsets of `value`; converted here.
   *  `null` keeps the previous set, live-mapped through edits. */
  diagnostics?: readonly SourceLint[] | null;
  ref?: Ref<ZplCodeMirrorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const lastEmitted = useRef(value);
  const [localeCompartment] = useState(() => new Compartment());
  const [readOnlyCompartment] = useState(() => new Compartment());
  const [highlightCompartment] = useState(() => new Compartment());
  const [historyCompartment] = useState(() => new Compartment());

  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), []);

  useEffect(() => {
    if (!host.current) return;
    const crlf = isPureCrlf(value);
    const state = EditorState.create({
      doc: value,
      extensions: [
        ...(crlf ? [EditorState.lineSeparator.of('\r\n')] : []),
        lineNumbers(),
        historyCompartment.of(history()),
        codeFolding(),
        zplFolding,
        foldGutter(),
        zplHighlighter,
        theme,
        readOnlyCompartment.of(readOnlyExt(readOnly)),
        highlightCompartment.of(highlightExt(highlightLines)),
        localeCompartment.of(localeExt(ariaLabel, placeholderText)),
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const synced = u.transactions.some((tr) => tr.annotation(propSync));
          if (!synced) {
            const text = docText(u.state);
            lastEmitted.current = text;
            onChangeRef.current(text);
          }
          // A sync is a fresh document, so it re-folds like a mount; the
          // typed-in-an-unfolded-blob protection only applies to user edits.
          const folds = synced
            ? blobFoldEffects(u.state, 0, u.state.doc.length)
            : foldsForInsertedBlobs(u);
          if (folds.length > 0) {
            // Deferred out of the update cycle.
            setTimeout(() => {
              if (viewRef.current === u.view) u.view.dispatch({ effects: folds });
            }, 0);
          }
        }),
      ],
    });
    const view = new EditorView({ parent: host.current, state });
    viewRef.current = view;
    // Fold the payload blobs up front; foldService alone only powers the gutter.
    const folds = blobFoldEffects(view.state, 0, view.state.doc.length);
    if (folds.length > 0) view.dispatch({ effects: folds });
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Mount-once: doc changes flow through the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live, so a mid-session locale switch reaches label and placeholder.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: localeCompartment.reconfigure(localeExt(ariaLabel, placeholderText)),
    });
  }, [ariaLabel, placeholderText, localeCompartment]);

  const mountEpoch = useRef(historyEpoch);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || historyEpoch === mountEpoch.current) return;
    mountEpoch.current = historyEpoch;
    // Removing the extension destroys its state field; re-adding starts fresh.
    view.dispatch({ effects: historyCompartment.reconfigure([]) });
    view.dispatch({ effects: historyCompartment.reconfigure(history()) });
  }, [historyEpoch, historyCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Echo guard doubling as a cheap identity check on multi-MB buffers: the
    // doc already holds this text (mount value or its own last emit).
    if (value === lastEmitted.current) return;
    // Unconditionally, or a doc-equal value (bare-\r normalization) leaves a
    // stale guard that later short-circuits a real sync.
    lastEmitted.current = value;
    const old = docText(view.state);
    if (old !== value) {
      // Minimal splice, not a full replace: folds, selection and scroll then
      // survive by mapping (a live resize regenerates the export per frame).
      // String offsets equal doc positions only without the CRLF facet.
      let from = 0;
      let oldEnd = old.length;
      let newEnd = value.length;
      if (view.state.lineBreak === '\n') {
        const minLen = Math.min(oldEnd, newEnd);
        while (from < minLen && old.charCodeAt(from) === value.charCodeAt(from)) from++;
        while (oldEnd > from && newEnd > from && old.charCodeAt(oldEnd - 1) === value.charCodeAt(newEnd - 1)) {
          oldEnd--;
          newEnd--;
        }
      }
      view.dispatch({
        changes: { from, to: view.state.doc.length - (old.length - oldEnd), insert: value.slice(from, newEnd) },
        // Undo must not reach back into synced exports.
        annotations: [propSync.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }, [value]);

  // After the value sync, so positions land on the fresh doc. Counting CRLFs
  // is facet-independent: CM collapses each to ONE position either way.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || diagnostics == null) return;
    const lints = diagnostics;
    // Dispatching installs lint's extensions and rebuilds the CRLF index, so
    // a clean buffer (the common case) must not pay for an empty set.
    if (lints.length === 0 && diagnosticCount(view.state) === 0) return;
    const crlfIdx: number[] = [];
    for (let i = value.indexOf('\r\n'); i !== -1; i = value.indexOf('\r\n', i + 2)) crlfIdx.push(i);
    // Binary search, not a running cursor: the mapping must not depend on the
    // order the lints arrive in, and a scan per lint is quadratic on a
    // CRLF-heavy buffer.
    const toDocPos = (offset: number): number => {
      let lo = 0;
      let hi = crlfIdx.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((crlfIdx[mid] ?? 0) < offset) lo = mid + 1;
        else hi = mid;
      }
      return Math.min(offset - lo, view.state.doc.length);
    };
    const mapped: Diagnostic[] = lints.map((d) => ({
      from: toDocPos(d.from),
      to: toDocPos(d.to),
      severity: CM_SEVERITY[d.severity],
      message: d.message,
    }));
    // Compared against what the editor HOLDS: a lagging build is skipped and
    // CM maps its marks through edits, so a remembered key would go stale.
    // Re-dispatching an unchanged set closes an open tooltip under the pointer.
    if (sameDiagnostics(view.state, mapped)) return;
    view.dispatch(setDiagnostics(view.state, mapped));
  }, [diagnostics, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExt(readOnly)) });
  }, [readOnly, readOnlyCompartment]);

  // After the value sync above, so line positions resolve on the fresh doc.
  // Compared by CONTENT: the producer hands a fresh Set per model change, and
  // reacting to identity re-scrolled the pane every drag/resize frame.
  const shownLines = useRef<ReadonlySet<number>>(NO_LINES);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const prev = shownLines.current;
    if (prev.size === highlightLines.size && [...highlightLines].every((l) => prev.has(l))) return;
    shownLines.current = highlightLines;
    const effects: StateEffect<unknown>[] = [highlightCompartment.reconfigure(highlightExt(highlightLines))];
    const first = highlightLines.size ? Math.min(...highlightLines) : null;
    if (first !== null && first < view.state.doc.lines) {
      // Nearest, not center: a selection click shouldn't yank a visible pane around.
      effects.push(EditorView.scrollIntoView(view.state.doc.line(first + 1).from, { y: 'nearest' }));
    }
    view.dispatch({ effects });
  }, [highlightLines, highlightCompartment]);

  // isEditableTarget's contract; on the HOST because focus/clicks can land
  // outside .cm-content (see the marker's JSDoc in lib/dom.ts).
  return <div ref={host} data-text-surface className="flex-1 min-h-0 overflow-hidden" />;
}
