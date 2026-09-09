import type { EditorView } from '@codemirror/view';
import type { Diagnostic } from '@codemirror/lint';
import type { SourceLint } from './sourceDiagnostics';
import { fixInsertion } from './zplLanguage';

/** Total map, so a new semantic severity cannot silently render as a hint. */
const CM_SEVERITY: Record<SourceLint['severity'], 'error' | 'hint' | 'warning'> = {
  error: 'error',
  related: 'hint',
  warning: 'warning',
};

/** A lint in doc positions as a CodeMirror diagnostic, its repair as an action. */
export function toDiagnostic(d: SourceLint, docPos: (offset: number) => number): Diagnostic {
  const { fix } = d;
  return {
    from: docPos(d.from),
    to: docPos(d.to),
    severity: CM_SEVERITY[d.severity],
    message: d.message,
    actions: fix
      ? [
          {
            name: fix.label,
            // `to` arrives live: CM has mapped the range through edits made since the build.
            apply: (view: EditorView, _from: number, to: number) => {
              if (view.state.readOnly) return;
              view.dispatch(fixInsertion(view.state, fix.command, to));
            },
          },
        ]
      : undefined,
  };
}
