import type { DocumentQueryFacts } from "./outputChoice";

export const queryFacts = (facts: Partial<DocumentQueryFacts> = {}): DocumentQueryFacts => ({ commands: [], prints: true, unmarked: [], ambiguous: [], uncounted: [], ...facts });
