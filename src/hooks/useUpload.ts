import { useState } from "react";

/** `run` resolves null when it worked, else its own failure value. */
export function useUpload<E, A extends unknown[] = []>(run: (file: File, ...args: A) => Promise<E | null>, onThrow: E) {
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<E | null>(null);
  const start = (file: File, ...args: A) => {
    setIssue(null);
    setBusy(true);
    void run(file, ...args)
      .then(setIssue)
      // No logging path in this app, so the inline hint is the only signal.
      .catch(() => setIssue(onThrow))
      .finally(() => setBusy(false));
  };
  return { busy, issue, start };
}
