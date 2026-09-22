import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { qrFdPayloadStart } from '@zplab/core/lib/qrFd';
import { stripDataLineBreaks } from '@zplab/core/lib/zplParser/helpers';
import { commandName, commandOccurrences } from './zplLanguage';

class HintWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  eq(other: HintWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-zplBlankHint';
    span.textContent = this.text;
    return span;
  }
  /** A click on the label places the caret beside it, as on text. */
  ignoreEvent(): boolean {
    return false;
  }
}

const DATA_COMMANDS = new Set(['^FD', '^FV']);

/** Commands that bound a field: the search for its ^FN and ^BQ stops here. */
const FIELD_BOUNDARY = new Set(['^FO', '^FT', '^FS', '^XA', '^XZ']);

/** The command ids sharing the field of `node`, in either direction. */
function* fieldCommands(state: EditorState, node: SyntaxNode): Generator<string> {
  for (const step of ['prevSibling', 'nextSibling'] as const) {
    for (let sibling = node[step]; sibling; sibling = sibling[step]) {
      const id = commandName(state, sibling.firstChild);
      if (id === null) continue;
      if (FIELD_BOUNDARY.has(id)) break;
      yield id;
    }
  }
}

/** Where the empty data slot of the data command `node` begins, or null when the field is filled or the printer fills it. */
function blankSlot(state: EditorState, node: SyntaxNode, dataFrom: number): number | null {
  const ids = [...fieldCommands(state, node)];
  if (ids.includes('^FN')) return null;
  // A line break is the one byte the printer drops from field data.
  const data = stripDataLineBreaks(state.sliceDoc(dataFrom, node.to));
  const start = ids.includes('^BQ') ? qrFdPayloadStart(data) : 0;
  return start === data.length ? dataFrom + start : null;
}

function blankHints(view: EditorView, widget: HintWidget): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const decoration = Decoration.widget({ widget, side: 1 });
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    for (const occurrence of commandOccurrences(view.state, from, to)) {
      if (!DATA_COMMANDS.has(occurrence.id)) continue;
      const node = tree.resolveInner(occurrence.from, 1).parent;
      const at = node ? blankSlot(view.state, node, occurrence.to) : null;
      if (at !== null && at >= from && at <= to) builder.add(at, at, decoration);
    }
  }
  return builder.finish();
}

/** Labels every empty ^FD or ^FV slot with `hint`, read from the text, so typing into a slot clears its label. */
export function blankFieldsExt(hint: string | undefined): Extension {
  if (hint === undefined) return [];
  const widget = new HintWidget(hint);
  return EditorView.decorations.of((v) => blankHints(v, widget));
}
