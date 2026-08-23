import { selectEditorFrozen, useLabelStore } from '../../../store/labelStore';

/** Own lock plus the editor freeze (see selectEditorFrozen); a frozen
 *  commit would no-op and leave a ghost position. */
export function useNodeDraggable(obj: { locked?: boolean }): boolean {
  const frozen = useLabelStore(selectEditorFrozen);
  return !obj.locked && !frozen;
}
