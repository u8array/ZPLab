import { asksPrinter, documentQueryFacts, type DocumentQueryFacts, type OutputFacts, type OutputSource } from "../lib/outputChoice";
import { sendZpl } from "../lib/sendZpl";
import { useLabelStore } from "../store/labelStore";

/** The notices need one row, since it carries every command. A query reads every row, since any row can spoil a reply. */
export function useDocumentQuery(source: OutputSource, facts: OutputFacts, zpl: () => string): { sample: string; query: DocumentQueryFacts } {
  const sample = useLabelStore((s) => (source === "label" ? sendZpl(s, 1) : ""));
  const sampleQuery = documentQueryFacts(source === "label" ? sample : zpl(), source, facts);
  const outgoing = useLabelStore((s) => (source === "label" && asksPrinter(sampleQuery) ? sendZpl(s) : ""));
  return { sample, query: outgoing === "" ? sampleQuery : documentQueryFacts(outgoing, source, facts) };
}
