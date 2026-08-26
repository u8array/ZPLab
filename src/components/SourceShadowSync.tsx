import { useSourceShadowSync } from '../hooks/useSourceEditShadow';

/** Effect-only host for the parsed draft, which feeds the canvas preview AND
 *  the editor's diagnostics: owned above both, rendering nothing so the
 *  per-keystroke draft stays out of the shell's render. */
export function SourceShadowSync(): null {
  useSourceShadowSync();
  return null;
}
