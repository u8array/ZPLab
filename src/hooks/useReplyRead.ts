import { useEffect, useRef, useState } from "react";
import type { PrinterOutcome } from "../lib/printerQuery";

export type ReplyShown<T> = PrinterOutcome<T> | "reading";
type ReplyRead<T> = ReplyShown<T> | undefined;

interface ReplyReadHandle<T> {
  read: ReplyRead<T>;
  start: (run: (signal: AbortSignal) => Promise<PrinterOutcome<T>>) => void;
  stop: () => void;
  close: () => void;
}

/** A printer read behind a dialog: a reply that lands after the user closed it must not reopen it, and a closed or
 *  unmounted dialog ends a read that takes the signal instead of holding the channel until the deadline. */
export function useReplyRead<T>(): ReplyReadHandle<T> {
  const [read, setRead] = useState<ReplyRead<T>>();
  const waiting = useRef<AbortController>(null);
  const stop = () => waiting.current?.abort();
  useEffect(() => () => waiting.current?.abort(), []);
  return {
    read,
    start: (run) => {
      const controller = new AbortController();
      waiting.current = controller;
      setRead("reading");
      void run(controller.signal).then((result) => setRead((current) => (current === "reading" ? result : current)));
    },
    stop,
    close: () => {
      stop();
      setRead(undefined);
    },
  };
}
