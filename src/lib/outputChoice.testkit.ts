import type { DocumentQueryFacts } from "./outputChoice";

export const queryFacts = (facts: Partial<DocumentQueryFacts> = {}): DocumentQueryFacts => ({ commands: [], labels: 1, held: true, unmarked: [], ambiguous: [], uncounted: [], ...facts });
