import { getCredential, setCredential } from "./credentialStore";
import { serverApiBase } from "./printReach";
import type { StreamDoneResult } from "./replyStream";

/** Mirrors a printer in the server's list, which carries no address. */
export interface ServerPrinter {
  id: string;
  name: string;
}

export type ServerFailure = { kind: "unauthorized" } | { kind: "server_unreachable" } | { kind: "error"; message: string };

/** The server answered and no printer took the request. */
type NoPrinter = { kind: "refused" } | { kind: "unreachable" } | { kind: "unconfigured" };

export type ServerSendResult = { kind: "sent" } | NoPrinter | ServerFailure;

export type ServerQueryResult = StreamDoneResult | NoPrinter | ServerFailure;

/** The route answers `error` for a write cut short, which folds to `unreachable`. */
export const SEND_FOLD = {
  sent: { kind: "sent" },
  refused: { kind: "refused" },
  unreachable: { kind: "unreachable" },
  error: { kind: "unreachable" },
} as const satisfies Record<string, ServerSendResult>;

export const LAST_FOLD = {
  refused: { kind: "refused" },
  unreachable: { kind: "unreachable" },
  too_large: { kind: "error", message: "response too large" },
  error: { kind: "unreachable" },
} as const satisfies Record<string, ServerQueryResult>;

/** A stopped read gets no last line, so `stopped` is not in `SERVER_ENDS`. */
export const SERVER_ENDS = ["closed", "deadline", "lost"] as const;

const UNEXPECTED: ServerFailure = { kind: "error", message: "unexpected answer from the server" };

/** The server gives the connect and the write to a printer 4 s each, so a later answer is none. */
export const ANSWER_MS = 15_000;

/** The client deadline runs during the upload, and the server takes up to 16 MiB, so a large body gets its time on a line of 1 Mbit/s or more. */
const uploadMs = (body: Uint8Array): number => Math.round(body.length / 125);

const SERVER_TOKEN_CRED = "server-token";

export const saveServerToken = (token: string): Promise<void> => setCredential(SERVER_TOKEN_CRED, token);

/** A token no header carries goes unsent, so the server refuses the request. */
function authorization(token: string | null): Record<string, string> {
  if (!token) return {};
  const header = { Authorization: `Bearer ${token}` };
  try {
    new Headers(header);
    return header;
  } catch {
    return {};
  }
}

async function call(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response | ServerFailure> {
  if (serverApiBase === undefined) return { kind: "error", message: "This build has no ZPLab server" };
  try {
    const token = await getCredential(SERVER_TOKEN_CRED);
    const res = await fetch(`${serverApiBase}${path}`, { ...init, headers: { ...init.headers, ...authorization(token) }, signal });
    return res.status === 401 ? { kind: "unauthorized" } : res;
  } catch {
    return { kind: "server_unreachable" };
  }
}

function post(path: string, json: unknown, answerMs: number, signal?: AbortSignal): Promise<Response | ServerFailure> {
  const body = new TextEncoder().encode(JSON.stringify(json));
  const bound = AbortSignal.timeout(uploadMs(body) + answerMs);
  return call(path, signal ? AbortSignal.any([signal, bound]) : bound, { method: "POST", headers: { "Content-Type": "application/json" }, body });
}

const httpError = (res: Response): ServerFailure => ({ kind: "error", message: `HTTP ${res.status}` });

/** A cut body reads as the server out of reach. A body that arrived and is no JSON is an unexpected answer. */
async function answered<T>(res: Response, read: (answer: unknown) => T | ServerFailure): Promise<T | ServerFailure> {
  const text = await res.text().catch(() => undefined);
  if (text === undefined) return { kind: "server_unreachable" };
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return UNEXPECTED;
  }
  return read(answer);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const kindOf = (value: unknown): string | undefined => (isRecord(value) && typeof value.kind === "string" ? value.kind : undefined);

function folded<T>(table: Readonly<Record<string, T>>, kind: string | undefined): T | ServerFailure {
  const hit = kind !== undefined && Object.hasOwn(table, kind) ? table[kind] : undefined;
  return hit ?? UNEXPECTED;
}

const isPrinter = (value: unknown): value is ServerPrinter => isRecord(value) && typeof value.id === "string" && typeof value.name === "string";

const isEnd = (value: unknown): value is (typeof SERVER_ENDS)[number] => SERVER_ENDS.some((end) => end === value);

export async function listServerPrinters(): Promise<{ kind: "ok"; printers: ServerPrinter[] } | ServerFailure> {
  const res = await call("/printers", AbortSignal.timeout(ANSWER_MS));
  if (!(res instanceof Response)) return res;
  if (!res.ok) return httpError(res);
  return answered(res, (answer) =>
    isRecord(answer) && Array.isArray(answer.printers) && answer.printers.every(isPrinter) ? { kind: "ok", printers: answer.printers } : UNEXPECTED,
  );
}

export async function sendZplServer(id: string, zpl: string): Promise<ServerSendResult> {
  const res = await post(`/printers/${encodeURIComponent(id)}/send`, { zpl }, ANSWER_MS);
  if (!(res instanceof Response)) return res;
  if (res.status === 404) return { kind: "unconfigured" };
  if (!res.ok) return httpError(res);
  return answered(res, (answer) => folded<ServerSendResult>(SEND_FOLD, kindOf(answer)));
}

async function* jsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) yield JSON.parse(line) as unknown;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/** Hands each piece of the reply to `onText` in order. An aborted `signal` ends the read as stopped. */
export async function queryZplServer(id: string, zpl: string, deadlineMs: number, signal: AbortSignal, onText: (text: string) => void): Promise<ServerQueryResult> {
  let chunks = 0;
  const stopped = (): ServerQueryResult => ({ kind: "done", end: "stopped", chunks });
  // The server ends the read at the deadline, so the bound outlasts it.
  const res = await post(`/printers/${encodeURIComponent(id)}/query`, { zpl, deadlineMs }, deadlineMs + ANSWER_MS, signal);
  if (!(res instanceof Response)) return signal.aborted ? stopped() : res;
  if (res.status === 404) return { kind: "unconfigured" };
  if (!res.ok || !res.body) return httpError(res);
  try {
    for await (const line of jsonLines(res.body)) {
      const kind = kindOf(line);
      if (kind === "text" && isRecord(line) && typeof line.text === "string") {
        chunks += 1;
        onText(line.text);
      } else if (kind === "done") {
        return isRecord(line) && isEnd(line.end) ? { kind: "done", end: line.end, chunks } : UNEXPECTED;
      } else {
        return folded<ServerQueryResult>(LAST_FOLD, kind);
      }
    }
  } catch {
    // A cut body and a line that is no JSON both leave the reply without its last line.
  }
  return signal.aborted ? stopped() : { kind: "done", end: "lost", chunks };
}
