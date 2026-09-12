import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { catalogRow } from '@zplab/core/catalog';
import { commandOccurrences } from './zplLanguage';

const MARK = Decoration.mark({ class: 'cm-zplCommandMatch' });

function commandMarks(view: EditorView, row: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (const occurrence of commandOccurrences(view.state, from, to)) {
      // Matched by row, not by spelling: ^HL and ~HL share a row, and every device font sits on ^A.
      if (catalogRow(occurrence.id) === row) builder.add(occurrence.from, occurrence.to, MARK);
    }
  }
  return builder.finish();
}

/** Marks every occurrence of a catalog row named by any of its spellings. Null or an unknown command marks nothing. */
export function commandMarksExt(command: string | null): Extension {
  const row = command === null ? undefined : catalogRow(command);
  return row === undefined ? [] : EditorView.decorations.of((v) => commandMarks(v, row));
}
