// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { parseSgdDump } from "@zplab/core/lib/sgd";
import { ZD230_ALLCV_EXCERPT } from "@zplab/core/lib/sgd.fixture";
import { AdoptSettingsDialog } from "./AdoptSettingsDialog";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";

const loc = en.printerSettings.printerStatus;
const measured = { kind: "ok", value: parseSgdDump(ZD230_ALLCV_EXCERPT) } as const;
const dump = (text: string) => ({ kind: "ok", value: parseSgdDump(text) }) as const;
const adoptPrinterSettings = useLabelStore.getState().adoptPrinterSettings;

afterEach(cleanup);

beforeEach(() => {
  act(() => {
    useLabelStore.setState({ label: { widthMm: 100, heightMm: 60, dpmm: 8 }, printerProfile: {}, adoptPrinterSettings });
  });
});

describe("AdoptSettingsDialog", () => {
  it("ticks only the settings that differ", () => {
    act(() => {
      useLabelStore.setState({ label: { widthMm: 100, heightMm: 60, dpmm: 8, labelTop: 30 } });
    });
    const r = render(<AdoptSettingsDialog read={measured} onClose={() => undefined} />);
    expect((r.getByLabelText(/print\.tone/) as HTMLInputElement).checked).toBe(true);
    expect((r.getByLabelText(/zpl\.label_top/) as HTMLInputElement).checked).toBe(false);
  });

  it("adopts only the ticked rows and closes", () => {
    const onClose = vi.fn();
    const r = render(<AdoptSettingsDialog read={measured} onClose={onClose} />);
    act(() => {
      fireEvent.click(r.getByLabelText(/ezpl\.print_width/));
    });
    act(() => {
      fireEvent.click(r.getByText(loc.adoptApply));
    });
    const label = useLabelStore.getState().label;
    expect(label.instantDarkness).toBe(15);
    expect(label.widthMm).toBe(100);
    expect(useLabelStore.getState().printerProfile.reprintAfterError).toBe("N");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the value the app would hold with the printer's own answer beside it", () => {
    const r = render(<AdoptSettingsDialog read={dump("ezpl.print_width : 813\nhead.resolution.in_dpi : 203\n")} onClose={() => undefined} />);
    expect(r.getByText("101.6")).toBeTruthy();
    expect(r.getByText("813")).toBeTruthy();
  });

  it("lists a value the app cannot hold without a checkbox", () => {
    const r = render(<AdoptSettingsDialog read={dump("media.printmode : cutter\n")} onClose={() => undefined} />);
    expect(r.getByText(loc.adoptNotConvertible)).toBeTruthy();
    expect(r.getByText("^MM")).toBeTruthy();
    expect(r.queryByLabelText(/media\.printmode/)).toBeNull();
  });

  it("says the printer differs even when no row can be adopted", () => {
    const r = render(<AdoptSettingsDialog read={dump("media.printmode : cutter\n")} onClose={() => undefined} />);
    expect(r.getByText(loc.adoptDiffersUnadoptable)).toBeTruthy();
    expect(r.queryByText(loc.adoptNothing)).toBeNull();
  });

  it("says nothing differs when the printer and the app agree", () => {
    act(() => {
      useLabelStore.setState({ label: { widthMm: 100, heightMm: 60, dpmm: 8, labelTop: 30 } });
    });
    const r = render(<AdoptSettingsDialog read={dump("zpl.label_top : 30\n")} onClose={() => undefined} />);
    expect(r.getByText(loc.adoptNothing)).toBeTruthy();
    expect((r.getByLabelText(/zpl\.label_top/) as HTMLInputElement).checked).toBe(false);
  });

  it("stays open and says so when the store refuses the patch", () => {
    const onClose = vi.fn();
    act(() => {
      useLabelStore.setState({ adoptPrinterSettings: () => false });
    });
    const r = render(<AdoptSettingsDialog read={measured} onClose={onClose} />);
    act(() => {
      fireEvent.click(r.getByText(loc.adoptApply));
    });
    expect(r.getByText(loc.adoptRefused)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
