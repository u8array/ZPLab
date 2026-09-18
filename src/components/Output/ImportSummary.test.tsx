// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ImportSummaryBody } from "./ImportSummary";
import type { ImportReport } from "@zplab/core/lib/zplParser";

const clean = { findings: [] } as unknown as ImportReport;

afterEach(cleanup);

describe("ImportSummaryBody", () => {
  it("names the uploads the profile kept and hands off to the one tab that holds them", () => {
    const open = vi.fn();
    const { getByText } = render(
      <ImportSummaryBody result={{ objectCount: 1, report: clean, profileUploads: { fonts: 2, graphics: 0 } }} onOpenObjects={open} />,
    );
    expect(getByText(/Uploads kept in the printer profile: 2/)).toBeTruthy();
    fireEvent.click(getByText(/Show stored objects/));
    expect(open).toHaveBeenCalledWith("storedFonts");
  });

  it("offers one link per tab when fonts and graphics were kept", () => {
    const open = vi.fn();
    const { getByText } = render(
      <ImportSummaryBody result={{ objectCount: 1, report: clean, profileUploads: { fonts: 1, graphics: 1 } }} onOpenObjects={open} />,
    );
    fireEvent.click(getByText("Graphics"));
    expect(open).toHaveBeenLastCalledWith("storedGraphics");
    fireEvent.click(getByText("Fonts"));
    expect(open).toHaveBeenLastCalledWith("storedFonts");
  });

  it("names the settings the profile kept", () => {
    const { getByText } = render(<ImportSummaryBody result={{ objectCount: 0, report: clean, profileSettings: 1 }} />);
    expect(getByText(/Printer settings kept in the profile: 1/)).toBeTruthy();
  });

  it("says nothing about uploads when the profile kept none", () => {
    const { queryByText } = render(<ImportSummaryBody result={{ objectCount: 1, report: clean }} />);
    expect(queryByText(/Uploads kept/)).toBeNull();
  });
});
