/** Mirrors the Rust ReplyEnd. */
type ReplyEnd = "closed" | "deadline" | "stopped" | "lost";

/** Mirrors the Rust StreamDone. */
export interface StreamDone {
  end: ReplyEnd;
  chunks: number;
}

/** The `done` member the TCP and USB query results share. */
export type StreamDoneResult = { kind: "done" } & StreamDone;
