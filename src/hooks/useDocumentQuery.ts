import { documentReplies } from "@zplab/core/lib/documentReplies";
import { asksPrinter, type DocumentQueryFacts, type OutputSource } from "../lib/outputChoice";
import { sendZpl } from "../lib/sendZpl";
import { useLabelStore } from "../store/labelStore";

/** The notices need one row, since it carries every command. A query reads every row, since any row can spoil a reply. */
export function useDocumentQuery(source: OutputSource, zpl: () => string): { sample: string; query: DocumentQueryFacts } {
  const sample = useLabelStore((s) => (source === "label" ? sendZpl(s, 1) : ""));
  const sampleQuery = documentReplies(source === "label" ? sample : zpl());
  const outgoing = useLabelStore((s) => (source === "label" && asksPrinter(sampleQuery) ? sendZpl(s) : ""));
  return { sample, query: outgoing === "" ? sampleQuery : documentReplies(outgoing) };
}
