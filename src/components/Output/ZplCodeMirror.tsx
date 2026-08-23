import { useEffect, useRef, useState } from 'react';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { Compartment, EditorState, RangeSetBuilder, type StateEffect } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { codeFolding, foldService, foldGutter, foldKeymap, foldEffect, foldedRanges } from '@codemirror/language';
import { zplLineHighlights, opaquePayloadFold } from '../../lib/zplCmHighlight';
import { MAX_LINE_RENDER } from '../../lib/zplTokenStyles';

// Text.toString() always joins with LF; only sliceString honours the
// lineSeparator facet, and the store buffer must get the original separators.
const docText = (state: EditorState): string =>
  state.doc.sliceString(0, state.doc.length, state.lineBreak);

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
});

/** CodeMirror host for the source-edit buffer: shared-tokenizer colouring, auto-folded
 *  payload blobs. A bare \r has no CM representation, so the first edit normalizes it
 *  to \n; an untouched buffer stays byte-identical. */
export default function ZplCodeMirror({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const lastEmitted = useRef(value);
  const [ariaCompartment] = useState(() => new Compartment());

  useEffect(() => {
    if (!host.current) return;
    // Pure-CRLF only: the facet keeps CRLF buffers byte-identical, but under it a bare
    // \n would not split, collapsing a mixed document's LF pages into one line each.
    const crlf = /\r\n/.test(value) && !/(?<!\r)\n/.test(value);
    const state = EditorState.create({
      doc: value,
      extensions: [
        ...(crlf ? [EditorState.lineSeparator.of('\r\n')] : []),
        lineNumbers(),
        history(),
        codeFolding(),
        zplFolding,
        foldGutter(),
        zplHighlighter,
        theme,
        ariaCompartment.of(EditorView.contentAttributes.of({ 'aria-label': ariaLabel })),
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const text = docText(u.state);
          lastEmitted.current = text;
          onChangeRef.current(text);
          const folds = foldsForInsertedBlobs(u);
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
    // Doc length, not string length: they differ under a normalized separator.
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    viewRef.current = view;
    // Fold the payload blobs up front; foldService alone only powers the gutter.
    const folds = blobFoldEffects(view.state, 0, view.state.doc.length);
    if (folds.length > 0) view.dispatch({ effects: folds });
    view.focus();
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Mount-once: doc changes flow through the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live label, so a mid-session locale switch reaches the content element.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: ariaCompartment.reconfigure(
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      ),
    });
  }, [ariaLabel, ariaCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Echo guard doubling as a cheap identity check on multi-MB buffers: the
    // doc already holds this text (mount value or its own last emit).
    if (value === lastEmitted.current) return;
    if (docText(view.state) !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={host} className="flex-1 min-h-0 overflow-hidden" />;
}
