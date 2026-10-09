import { PNG_FILTER, saveErrorMessage, saveFile } from "./fileDialogs";
import { useLabelStore } from "../store/labelStore";

/** Writes a captured canvas image to a file the user picks. Takes the pending capture so a click handler
 *  can call it without an await, which Safari and Firefox need to keep the user activation. */
export async function saveLabelImage(pending: Promise<Blob | null>, filename: string): Promise<void> {
  const blob = await pending;
  if (!blob) return;
  const { setUserError, clearUserError } = useLabelStore.getState();
  await saveFile(blob, { filename, filters: [PNG_FILTER] })
    .then((wrote) => wrote && clearUserError())
    .catch(() => setUserError(saveErrorMessage));
}
