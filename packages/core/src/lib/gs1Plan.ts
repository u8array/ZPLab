import {
  completeTypedGtins,
  GS1_GS,
  parseGs1ToSegments,
  segmentsToElementString,
  segmentsToZplFd,
  segmentsToContent,
} from "./gs1";
import {
  gs1ContentToDataMatrixFd,
  typedGs1DataRuns,
  typedGs1ToDataMatrixFd,
} from "./dataMatrixFd";
import { hasTemplateMarkers } from "./fnTemplate";

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

/** Single GS1 ^FD derivation (planCode128Fd's sibling): emit, canvas and
 *  preflight consume it. Known limit: unparsed `>` invocations print as
 *  invocations (spec p.104) but render literally. */
export function planGs1Fd(content: string, carrier: Gs1Carrier): Gs1FdPlan {
  if (content === "") {
    return {
      fd: carrier === "datamatrix" ? gs1ContentToDataMatrixFd("") : "",
      bwipText: "",
      bwipParsefncText: null,
      losses: [],
    };
  }
  // The catalog must not segment around a marker (it would read the marker's
  // own characters as the field); post-substitution emitters pass the resolved
  // form themselves.
  if (hasTemplateMarkers(content)) {
    // Feeds preview only; emit resolves markers separately and never routes template content through .fd.
    const typed = carrier === "code128" ? completeTypedGtins(content) : null;
    // The canvas encodes the same runs the ^FD does, or it would size the
    // symbol from the parens and single FNC1 that never reach the wire.
    const dmRuns = carrier === "datamatrix" ? typedGs1DataRuns(content) : null;
    return {
      // ^BX takes the structural form (parens out, FNC1 by AI).
      fd:
        carrier === "datamatrix"
          ? (typedGs1ToDataMatrixFd(content) ?? gs1ContentToDataMatrixFd(content))
          : (typed ?? content),
      bwipText: typed ?? content,
      bwipParsefncText: dmRuns
        ? parsefncRuns(dmRuns.join(GS1_GS), "^FNC1")
        : parsefncRuns(typed ?? content, carrier === "datamatrix" ? "^FNC1" : ""),
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
      // From the segments: ^BX encodes verbatim, so a typed "(01)" would ship
      // its parens (only ^BC mode D strips them, spec p.95). Unstructured
      // remainders stay inside their segment's value.
      return parsed(gs1ContentToDataMatrixFd(segmentsToContent(segs)));
    case "databar":
      return parsed(content);
  }
}

/** GS1 carriers by leaf type; other types have no GS1 ^FD grammar. */
export function gs1CarrierFor(type: string): Gs1Carrier | null {
  return type === "code128" ? "code128"
    : type === "datamatrix" ? "datamatrix"
    : type === "gs1databar" ? "databar"
    : null;
}
