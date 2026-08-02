import {
  code128ControlFd,
  code128EscapeLiterals,
  code128PlainFd,
} from "./code128Subset";
import { C0_RE, resolveControlMarkers } from "../types/controlKey";

/** How a payload reaches a plain-^BC ^FD: `whole` = entire field (chips
 *  resolve), `template` = literal spans around markers, `templateValue` =
 *  ^FN declaration (chips stay marker TEXT in `fd`, losses approximate on
 *  resolved bytes), `sharedRaw` = shared slot. Serial/GS1 bypass this grammar. */
export type Code128FdMode = "whole" | "template" | "templateValue" | "sharedRaw";

export type Code128FdLoss =
  /** Control bytes cannot ride this mode's FD: they fall to ^FH, which the
   *  firmware drops from the symbol (ZD230). */
  | { kind: "controlBytesDropped" }
  /** `>` before an invocation char stays verbatim (import round-trip channel),
   *  so the firmware reads an invocation, not text. */
  | { kind: "invocationRead"; seqs: string[] }
  /** Raw emit: `>`/`^`/`~` reach the firmware unescaped and corrupt. */
  | { kind: "rawUnescaped" };

export interface Code128FdPlan {
  /** The ^FD payload the emitter writes (before fdField's ^FH hex pass). */
  fd: string;
  losses: Code128FdLoss[];
}

const INVOCATION_SEQ = />[0-9:;<=]/g;

function invocationSeqs(text: string): string[] {
  return [...new Set(text.match(INVOCATION_SEQ) ?? [])];
}

/** Invocation loss first (pinned detail order); the drop loss is C0-only,
 *  DEL ships as a raw byte on ^FH (routing class, not loss). */
function pushLosses(losses: Code128FdLoss[], bytes: string): void {
  const seqs = invocationSeqs(bytes);
  if (seqs.length > 0) losses.push({ kind: "invocationRead", seqs });
  if (C0_RE.test(bytes)) losses.push({ kind: "controlBytesDropped" });
}

/** Single derivation for plain-^BC field data: what the emitter writes and
 *  what the printer loses. Emit, the parser's byte-identity gates and the
 *  preflight loss channels all consume this, so they cannot drift. */
export function planCode128Fd(payload: string, mode: Code128FdMode): Code128FdPlan {
  const losses: Code128FdLoss[] = [];
  switch (mode) {
    case "whole": {
      const bytes = resolveControlMarkers(payload);
      const invocation = code128ControlFd(bytes);
      if (invocation !== null) return { fd: invocation, losses };
      pushLosses(losses, bytes);
      return { fd: code128PlainFd(bytes), losses };
    }
    case "template": {
      pushLosses(losses, resolveControlMarkers(payload));
      return { fd: code128EscapeLiterals(payload), losses };
    }
    case "templateValue": {
      pushLosses(losses, resolveControlMarkers(payload));
      return { fd: code128PlainFd(payload), losses };
    }
    case "sharedRaw": {
      const bytes = resolveControlMarkers(payload);
      if (/[>^~]/.test(bytes)) losses.push({ kind: "rawUnescaped" });
      if (C0_RE.test(bytes)) losses.push({ kind: "controlBytesDropped" });
      return { fd: bytes, losses };
    }
  }
}

export function planHasLoss(plan: Code128FdPlan, kind: Code128FdLoss["kind"]): boolean {
  return plan.losses.some((l) => l.kind === kind);
}
