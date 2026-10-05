import { useState } from "react";

/** `run` resolves null when it worked, else its own failure value. */
export function useUpload<E, I = File, A extends unknown[] = []>(run: (input: I, ...args: A) => Promise<E | null>, onThrow: E) {
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<E | null>(null);
  const start = (input: I, ...args: A) => {
    setIssue(null);
    setBusy(true);
    void run(input, ...args)
      .then(setIssue)
      // No logging path in this app, so the inline hint is the only signal.
      .catch(() => setIssue(onThrow))
      .finally(() => setBusy(false));
  };
  return { busy, issue, start };
}
