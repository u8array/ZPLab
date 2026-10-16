// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { ZplImportModal } from "./ZplImportModal";
import { useLabelStore } from "../../store/labelStore";
import { sendZpl } from "../../lib/sendZpl";
import { repliesToHost } from "@zplab/core/lib/hostCommands";

beforeEach(() => {
  useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8 }, pages: [{ objects: [] }], variables: [], currentPageIndex: 0, selectedIds: [] });
});

afterEach(cleanup);

const t = () => useLabelStore.getState().translations;
const paste = (text: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: t().importModal.importAction }));
};

describe("the import dialog's content gate", () => {
  it("accepts a paste that only queries the printer", () => {
    render(<ZplImportModal onClose={vi.fn()} />);
    paste("^XA\n~HS\n^XZ");
    expect(screen.queryByText(t().importModal.errNoObjects)).toBeNull();
    expect(repliesToHost(sendZpl(useLabelStore.getState()))).toEqual(["~HS"]);
  });

  it("refuses a format that neither asks nor draws", () => {
    render(<ZplImportModal onClose={vi.fn()} />);
    paste("^XA^XZ");
    expect(screen.getByText(t().importModal.errNoObjects)).toBeTruthy();
  });
});
