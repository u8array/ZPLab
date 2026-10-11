// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, act, fireEvent } from "@testing-library/react";
import { useLabelStore } from "../../store/labelStore";
import { defaultOutputChoice } from "../../lib/outputChoice";
import { fallbackTranslations as en } from "../../locales";
import { BASE_STATE, everything, loc, printButton, showDialog } from "./OutputDialog.testkit";

// A browser tab, where the system dialog is the only way to a printer without a Zebra channel.
vi.mock("../../lib/platform", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isDesktopShell: false }));

afterEach(cleanup);

const webFacts = { ...everything, canBatchExport: false, batchRowCount: 0 };

beforeEach(() => {
  act(() => {
    useLabelStore.setState({ ...BASE_STATE, outputChoice: defaultOutputChoice(false), previewProvider: "labelary" });
  });
});

describe("OutputDialog in the browser", () => {
  it("opens on the printer and the system dialog, with nothing to address", () => {
    const r = showDialog({ facts: webFacts });

    // The ways strip belongs to the print kind, and the system way is the one marked on it.
    expect(r.getByText(loc.tabSystem).getAttribute("aria-current")).toBe("page");
    expect(r.queryByText(en.app.exportPdf)).toBeNull();
    expect(r.queryByDisplayValue("172.17.17.175")).toBeNull();
    expect(printButton(r.container)).toBeTruthy();
  });

  it("lists the printer renderer but locks it, like the settings do", () => {
    const r = showDialog({ facts: webFacts });
    act(() => {
      fireEvent.click(r.getByRole("button", { name: loc.rendererHeading }));
    });
    expect(r.getByRole("option", { name: en.printerSettings.preview.providerPrinter }).getAttribute("aria-disabled")).toBe("true");
    expect(r.getByRole("option", { name: en.printerSettings.preview.providerNone }).getAttribute("aria-disabled")).toBeNull();
  });

  it("names the renderer that draws when the stored one cannot", () => {
    act(() => {
      useLabelStore.setState({ previewProvider: "printer" });
    });
    const r = showDialog({ facts: webFacts });
    // The stored printer choice degrades to Labelary off the desktop, not to the built-in renderer.
    expect(r.getByText(`Currently active: ${en.printerSettings.preview.providerLabelary}`)).toBeTruthy();
  });

  it("runs the print path the rendered label takes", async () => {
    const r = showDialog({ facts: webFacts });

    await act(async () => {
      fireEvent.click(printButton(r.container));
    });

    expect(r.props.onPrintImage).toHaveBeenCalled();
    expect(r.props.onClose).toHaveBeenCalled();
  });
});
