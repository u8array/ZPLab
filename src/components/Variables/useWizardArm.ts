import { useState } from 'react';
import { useLabelStore } from '../../store/labelStore';

/** The wizard's advance gate. `loaded` is true only after markLoaded (the
 *  wizard's own load), never from watching the shared dataset/token: a
 *  foreign load (MCP push, doc swap) can't advance the wizard or pass as its own on abort. */
export function useWizardArm() {
  const dataset = useLabelStore((s) => s.dataset);
  const datasetFetchToken = useLabelStore((s) => s.datasetFetchToken);
  // The data-context epoch of the wizard's own landed load; doubles as the
  // abort guard (restore only while that load is still the latest mutation).
  const [ownLoadToken, setOwnLoadToken] = useState<number | null>(null);
  // Bound to the epoch: a later foreign load leaves the mapping step instead
  // of letting Finish apply the wizard's mapping session to foreign data.
  const loaded = ownLoadToken !== null && !!dataset && datasetFetchToken === ownLoadToken;

  const markLoaded = () => setOwnLoadToken(useLabelStore.getState().datasetFetchToken);
  const reset = () => setOwnLoadToken(null);

  /** Run a fetch and mark the load as the wizard's own on success. */
  const loadArmed = async (fetchIt: () => Promise<boolean>): Promise<boolean> => {
    const ok = await fetchIt();
    if (ok) markLoaded();
    return ok;
  };

  return { loaded, ownLoadToken, markLoaded, reset, loadArmed };
}
