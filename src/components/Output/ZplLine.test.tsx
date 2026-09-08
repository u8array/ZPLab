// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ZplLine } from "./ZplLine";
import { MAX_LINE_RENDER } from "../../lib/zplLanguage";

afterEach(cleanup);

const spansOf = (container: HTMLElement) => [...container.querySelectorAll("span.block > span")].map((s) => [s.textContent, s.className]);

describe("ZplLine", () => {
  it("colours a line with the editor's language and keeps its text intact", () => {
    const { container } = render(<ZplLine line="^FO10,20^FDhi^FS" />);
    const spans = spansOf(container);
    expect(spans.map(([text]) => text).join("")).toBe("^FO10,20^FDhi^FS");
    expect(spans).toContainEqual(["^FO", "text-accent font-medium"]);
    expect(spans).toContainEqual(["10", "text-info"]);
    expect(spans).toContainEqual(["hi", "text-string"]);
  });

  it("keeps a blank line's row inside the pre", () => {
    const { container } = render(<ZplLine line="" />);
    expect(container.querySelector("span.block")?.textContent).toBe("\n");
  });

  it("truncates an overlong payload line and says how much is hidden", () => {
    const line = "^GFA,1,1,1," + "F".repeat(MAX_LINE_RENDER + 500);
    const { container } = render(<ZplLine line={line} />);
    const text = container.textContent ?? "";
    expect(text.length).toBeLessThan(MAX_LINE_RENDER + 100);
    expect(text).toContain(`(+${line.length - MAX_LINE_RENDER})`);
  });
});
