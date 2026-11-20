/** Shared fixtures and the import scanner for the headless, MCP and server tests. */

export function textObject(id: string, content: string) {
  return {
    id,
    type: "text",
    x: 10,
    y: 10,
    rotation: 0,
    props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" },
  };
}

/** A label the way a model hand-builds it: bytes a JSON round-trip must carry unchanged. */
export const demoLabel = {
  schemaVersion: 6,
  label: { widthMm: 100, heightMm: 60, dpmm: 8 },
  variables: [
    { name: "bezeichnung", defaultValue: "Bio-Müsli • Früchte" },
    { name: "preis", defaultValue: "4,99 €" },
  ],
  pages: [
    {
      objects: [
        textObject("titel", "«bezeichnung»"),
        { ...textObject("preis", "Preis: «preis»"), y: 60 },
        { ...textObject("hinweis", "• Ohne Zusätze • Äpfel aus der Region"), y: 110 },
        { id: "ean", type: "ean13", x: 10, y: 200, rotation: 0, props: { content: "400638133393", height: 80 } },
      ],
    },
    { objects: [textObject("rueck", "Rückseite: Zutaten • Nährwerte")] },
  ],
};

/** Minimal valid single-page design file. */
export const designFile = {
  schemaVersion: 3,
  label: { widthMm: 100, heightMm: 50, dpmm: 8 },
  pages: [{ objects: [textObject("t1", "HELLO")] }],
};

/** A static form is matched from its line start, so quoted prose never counts. */
export const importSpecs = (src: string): string[] => [
  ...[...src.matchAll(/^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? ""),
  ...[...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? ""),
  ...[...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? ""),
];
