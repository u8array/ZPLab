import { tokenizeZplLine } from "../../lib/zplTokenize";
import { TOKEN_CLASS, MAX_LINE_RENDER } from "../../lib/zplTokenStyles";

/** One line of rendered ZPL, syntax-highlighted per token (the Setup-Script
 *  preview pane; the output panel renders through CodeMirror). */
export function ZplLine({ line }: { line: string }) {
  const truncated = line.length > MAX_LINE_RENDER;
  const tokens = tokenizeZplLine(truncated ? line.slice(0, MAX_LINE_RENDER) : line);
  return (
    <span className="block">
      {/* A blank line collapses to zero height inside <pre>; keep its row. */}
      {tokens.length === 0
        ? "\n"
        : tokens.map((tok, i) => (
            <span key={i} className={TOKEN_CLASS[tok.type]}>
              {tok.value}
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
