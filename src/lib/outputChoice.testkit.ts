import type { DocumentQueryFacts } from "./outputChoice";

/** The facts of a document that prints and asks nothing, with the fields a test overrides. */
export const queryFacts = (facts: Partial<DocumentQueryFacts> = {}): DocumentQueryFacts => ({ commands: [], prints: true, unmarked: [], ambiguous: [], uncounted: [], ...facts });
