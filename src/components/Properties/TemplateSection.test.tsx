// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { TemplateSection } from "./TemplateSection";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";
import type { LabelObject, Page } from "@zplab/core/types/Group";

afterEach(cleanup);

const text = (id: string, marker: string): LabelObject =>
  ({ id, type: "text", x: 10, y: 10, rotation: 0, props: { content: `«${marker}»`, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as unknown as LabelObject;
const variables = [
  { id: "v1", name: "sku", fnNumber: 2, defaultValue: "" },
  { id: "v2", name: "lot", fnNumber: 1, defaultValue: "" },
  { id: "v3", name: "unused", fnNumber: 3, defaultValue: "" },
];
const csv = { kind: "csv" as const, filename: "orders.csv", importedAt: "", encoding: "utf-8", delimiter: ",", rowCount: 2 };
const state = () => useLabelStore.getState();
const setPages = (pages: Page[], currentPageIndex = 0) => {
  act(() => {
    useLabelStore.setState({ pages, currentPageIndex, variables, dataset: null, sidebarTab: "properties", printerSettingsTab: null });
  });
};

beforeEach(() => setPages([{ objects: [text("a", "sku"), text("b", "lot")] }, { objects: [text("c", "unused")] }]));

const openWays = (r: ReturnType<typeof render>) => {
  act(() => {
    fireEvent.click(r.getByRole("button", { name: /^Delivery/ }));
  });
};

describe("TemplateSection", () => {
  it("is one row until the page has a name, then shows the path, this page's slots and the dataset", () => {
    const r = render(<TemplateSection locked={false} />);
    expect(r.getByText(en.template.notStored)).toBeTruthy();
    expect(r.queryByRole("button", { name: /^Delivery/ })).toBeNull();
    expect(r.queryByText(en.template.slots)).toBeNull();
    setPages([{ objects: [text("a", "sku"), text("b", "lot")], storedFormatPath: "E:JOB.ZPL" }, { objects: [text("c", "unused")] }]);
    expect(r.getByText("E:JOB.ZPL")).toBeTruthy();
    expect(r.getByText("1 lot, 2 sku")).toBeTruthy();
    expect(r.getByText(en.template.noDataset)).toBeTruthy();
    act(() => {
      useLabelStore.setState({ dataset: { headers: ["sku"], rows: [["a"], ["b"]], source: csv, activeRowIndex: 0 } });
    });
    expect(r.getByText("orders.csv · 2 rows")).toBeTruthy();
  });

  it("clears the name but keeps the drive for the next one", () => {
    setPages([{ objects: [], storedFormatPath: "R:JOB.ZPL" }]);
    const r = render(<TemplateSection locked={false} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: en.template.clear }));
    });
    expect(state().pages[0]).not.toHaveProperty("storedFormatPath");
    fireEvent.change(r.getByLabelText(en.template.onPrinter), { target: { value: "NEW" } });
    expect(state().pages[0]?.storedFormatPath).toBe("R:NEW.ZPL");
  });

  it("starts the next page on flash instead of the drive the last page cleared", () => {
    setPages([{ objects: [], storedFormatPath: "R:AAA.ZPL" }, { objects: [] }]);
    const r = render(<TemplateSection locked={false} />);
    act(() => {
      useLabelStore.setState({ currentPageIndex: 1 });
    });
    fireEvent.change(r.getByLabelText(en.template.onPrinter), { target: { value: "NEW" } });
    expect(state().pages[1]?.storedFormatPath).toBe("E:NEW.ZPL");
  });

  it("picks a drive without a name as a draft, so the page and the undo history stay untouched", () => {
    setPages([{ objects: [] }]);
    useLabelStore.temporal.getState().clear();
    const r = render(<TemplateSection locked={false} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: en.registry.image.storage }));
    });
    act(() => {
      r.getByRole("option", { name: "R:" }).click();
    });
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
    fireEvent.change(r.getByLabelText(en.template.onPrinter), { target: { value: "NEW" } });
    expect(state().pages[0]?.storedFormatPath).toBe("R:NEW.ZPL");
  });

  it("lists only the slots the stored format declares", () => {
    const hidden = { ...text("a", "sku"), includeInExport: false } as LabelObject;
    setPages([{ objects: [hidden, text("b", "lot")], storedFormatPath: "E:JOB.ZPL" }]);
    const r = render(<TemplateSection locked={false} />);
    expect(r.getByText("1 lot")).toBeTruthy();
    setPages([{ objects: [hidden], storedFormatPath: "E:JOB.ZPL" }]);
    expect(r.getByText(en.template.noSlots)).toBeTruthy();
  });

  it("opens the printer settings where the setup script is on screen", () => {
    setPages([{ objects: [], storedFormatPath: "E:JOB.ZPL", storedFormatDelivery: "setup" }]);
    const r = render(<TemplateSection locked={false} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: en.template.openSetupScript }));
    });
    expect(state().printerSettingsTab).toBe("clockTime");
  });

  it("locks the name, the drive and the clear with the editor", () => {
    setPages([{ objects: [], storedFormatPath: "E:JOB.ZPL" }]);
    const r = render(<TemplateSection locked />);
    expect((r.getByLabelText(en.template.onPrinter) as HTMLInputElement).disabled).toBe(true);
    expect((r.getByRole("button", { name: en.template.clear }) as HTMLButtonElement).disabled).toBe(true);
    expect((r.getByRole("button", { name: en.registry.image.storage }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hands the chosen way to the page and jumps to the variables", () => {
    setPages([{ objects: [], storedFormatPath: "E:JOB.ZPL" }]);
    const r = render(<TemplateSection locked={false} />);
    openWays(r);
    act(() => {
      r.getByRole("option", { name: "Once in the setup script" }).click();
    });
    expect(state().pages[0]?.storedFormatDelivery).toBe("setup");
    act(() => {
      fireEvent.click(r.getByRole("button", { name: en.template.openVariables }));
    });
    expect(state().sidebarTab).toBe("variables");
  });

  it("blocks the recall ways for a name ^XF cannot read, or that another page stores under", () => {
    setPages([{ objects: [], storedFormatPath: "E:VERYLONGNAME12.ZPL" }]);
    const long = render(<TemplateSection locked={false} />);
    openWays(long);
    expect(long.getByRole("option", { name: "Once in the setup script" }).getAttribute("aria-disabled")).toBe("true");
    expect(long.getByRole("option", { name: "Already on the printer" }).getAttribute("aria-disabled")).toBe("true");
    cleanup();
    setPages([{ objects: [], storedFormatPath: "E:JOB.ZPL" }, { objects: [], storedFormatPath: "E:JOB.ZPL" }]);
    const twice = render(<TemplateSection locked={false} />);
    expect(twice.queryByText(en.delivery.formatNameContested)).toBeNull();
    openWays(twice);
    expect(twice.getByRole("option", { name: "Once in the setup script" }).getAttribute("aria-disabled")).toBe("true");
    cleanup();
    setPages([{ objects: [], storedFormatPath: "E:JOB.ZPL", storedFormatDelivery: "setup" }, { objects: [], storedFormatPath: "E:JOB.ZPL" }]);
    const chosen = render(<TemplateSection locked={false} />);
    expect(chosen.getByText(en.delivery.formatNameContested)).toBeTruthy();
  });
});
