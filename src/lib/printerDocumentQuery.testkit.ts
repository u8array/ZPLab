import type { DocumentReply } from "./printerDocumentQuery";

export const documentReply = (reply: Partial<DocumentReply>): DocumentReply => ({ raw: "", configuration: false, parsed: {}, unanswered: [], ...reply });
