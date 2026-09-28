// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PdfExportDialog } from "./PdfExportDialog";

afterEach(cleanup);

describe("PdfExportDialog", () => {
  it("counts the label being rendered, never past the total, and drops the cancel once the file is written", () => {
    let cancelled = 0;
    const r = render(<PdfExportDialog progress={{ done: 1, total: 3, saving: false }} onCancel={() => cancelled++} />);
    expect(r.getByText("Rendering label 2 of 3…")).toBeTruthy();
    fireEvent.click(r.getByRole("button", { name: "Cancel" }));
    expect(cancelled).toBe(1);
    cleanup();
    const saving = render(<PdfExportDialog progress={{ done: 3, total: 3, saving: true }} onCancel={() => cancelled++} />);
    expect(saving.getByText("Saving the file…")).toBeTruthy();
    expect(saving.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
