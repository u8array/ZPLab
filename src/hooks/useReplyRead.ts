import { useState } from "react";
import type { PrinterOutcome } from "../lib/printerQuery";

export type ReplyShown<T> = PrinterOutcome<T> | "reading";
type ReplyRead<T> = ReplyShown<T> | undefined;

/** A printer read behind a dialog: a reply that lands after the user closed it must not reopen it. */
export function useReplyRead<T>(): { read: ReplyRead<T>; start: (run: () => Promise<PrinterOutcome<T>>) => void; close: () => void } {
  const [read, setRead] = useState<ReplyRead<T>>();
  return {
    read,
    start: (run) => {
      setRead("reading");
      void run().then((result) => setRead((current) => (current === "reading" ? result : current)));
    },
    close: () => setRead(undefined),
  };
}
