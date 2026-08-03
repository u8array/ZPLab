import {
  GS1_GS,
  parseGs1ToSegments,
  segmentsToElementString,
  segmentsToZplFd,
} from "./gs1";
import { gs1ContentToDataMatrixFd } from "./dataMatrixFd";
import { hasTemplateMarkers } from "./fnTemplate";
import { getEntry, isGs1Active } from "../registry";

/** GS1 carriers with distinct ^FD grammars: ^BC mode D (parenthesized + >8),
 *  ^BX quality 200 (`_1` escapes), ^BR (raw content; separator grammar is
 *  hardware-unverified, so the wire form stays what the app always emitted). */
export type Gs1Carrier = "code128" | "datamatrix" | "databar";

/** `unparsed`: content does not segment against the AI catalog, so the wire
 *  carries it verbatim and the canvas cannot promise the printed symbol.
 *  Never reported for DM: its `_1` codec encodes FNC1 positions exactly. */
export interface Gs1FdLoss {
  kind: "unparsed";
}

export interface Gs1FdPlan {
  /** The ^FD payload the emitter writes. */
  fd: string;
  /** bwip-js canvas input: element string when the content segments, else the
   *  verbatim content. */
  bwipText: string;
  /** Raw-FNC1 canvas fallback for unparsed content (bwip `parsefnc` text,
   *  carets doubled), mirroring the carrier's wire: DM keeps one FNC1 per GS
   *  and drops a trailing separator like the `_1` codec; code128 mode D
   *  strips GS per the measured C0 drop class. Null when the content parses. */
  bwipParsefncText: string | null;
  losses: Gs1FdLoss[];
}

function parsefncRuns(content: string, joiner: string): string {
  const runs = content.split(GS1_GS).map((run) => run.replaceAll("^", "^^"));
  while (runs.length > 1 && runs[runs.length - 1] === "") runs.pop();
  return `^FNC1${runs.join(joiner)}`;
}

/** Single GS1 derivation (planCode128Fd's sibling): mirrors the emit
 *  transforms (byte-equality pinned by test); canvas and preflight consume
 *  it. Known limit: unparsed `>` invocations print as invocations (spec
 *  p.104) but render literally on canvas. */
export function planGs1Fd(content: string, carrier: Gs1Carrier): Gs1FdPlan {
  if (content === "") {
    return {
      fd: carrier === "datamatrix" ? gs1ContentToDataMatrixFd("") : "",
      bwipText: "",
      bwipParsefncText: null,
      losses: [],
    };
  }
  const segs = parseGs1ToSegments(content);
  if (!segs || segs.length === 0) {
    const fd = carrier === "datamatrix" ? gs1ContentToDataMatrixFd(content) : content;
    return {
      fd,
      bwipText: content,
      bwipParsefncText: parsefncRuns(content, carrier === "datamatrix" ? "^FNC1" : ""),
      losses: carrier === "datamatrix" ? [] : [{ kind: "unparsed" }],
    };
  }
  const element = segmentsToElementString(segs);
  const parsed = (fd: string): Gs1FdPlan => ({ fd, bwipText: element, bwipParsefncText: null, losses: [] });
  switch (carrier) {
    case "code128":
      return parsed(segmentsToZplFd(segs));
    case "datamatrix":
      return parsed(gs1ContentToDataMatrixFd(content));
    case "databar":
      return parsed(content);
  }
}

/** Static GS1 content that ships verbatim: owns the gs1ContentUnparsed
 *  warning, and the canvas suppresses renderFailed on the same predicate.
 *  Template content is owned by markerValueFindings. */
export function gs1StaticUnparsed(type: string, props: object, content: string): boolean {
  const carrier = gs1CarrierFor(type);
  return carrier !== null
    && isGs1Active(getEntry(type), props)
    && !hasTemplateMarkers(content)
    && planGs1Fd(content, carrier).losses.length > 0;
}

/** GS1 carriers by leaf type; other types have no GS1 ^FD grammar. */
export function gs1CarrierFor(type: string): Gs1Carrier | null {
  return type === "code128" ? "code128"
    : type === "datamatrix" ? "datamatrix"
    : type === "gs1databar" ? "databar"
    : null;
}
