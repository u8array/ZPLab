import { highlightCode } from "@lezer/highlight";
import { buildZplTree, zplHighlightStyle, MAX_LINE_RENDER } from "../../lib/zplLanguage";

/** One line of rendered ZPL, coloured by the same language the editor uses
 *  (the Setup-Script preview pane; the output panel renders through CodeMirror). */
export function ZplLine({ line }: { line: string }) {
  const truncated = line.length > MAX_LINE_RENDER;
  const text = truncated ? line.slice(0, MAX_LINE_RENDER) : line;
  const spans: { text: string; cls: string }[] = [];
  // One line in, so the break callback never fires.
  highlightCode(
    text,
    buildZplTree(text),
    zplHighlightStyle,
    (code, cls) => spans.push({ text: code, cls }),
    () => undefined,
  );
  return (
    <span className="block">
      {/* A blank line collapses to zero height inside <pre>; keep its row. */}
      {spans.length === 0
        ? "\n"
        : spans.map((s, i) => (
            <span key={i} className={s.cls}>
              {s.text}
            </span>
          ))}
      {truncated && (
        <span className="text-muted italic">
          {` …(+${(line.length - MAX_LINE_RENDER).toLocaleString()})`}
        </span>
      )}
    </span>
  );
}
