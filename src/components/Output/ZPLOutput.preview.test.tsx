// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ZPLOutput } from "./ZPLOutput";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";
import type { LabelObject, Page } from "@zplab/core/types/Group";

afterEach(cleanup);

const textObject: LabelObject = { id: "t1", type: "text", x: 10, y: 10, rotation: 0, props: { content: "hello", fontHeight: 30, fontWidth: 0, rotation: "N" } } as never;

beforeEach(() => {
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    pages: [{ objects: [textObject] }] as Page[],
    variables: [],
    currentPageIndex: 0,
    selectedIds: [],
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
    sourceShadow: null,
    thirdParty: { labelary: true },
  });
});

describe("ZPLOutput preview button", () => {
  it("offers a rendered preview for Labelary and hides the button once the renderer is off", () => {
    useLabelStore.setState({ previewProvider: "labelary" });
    const r = render(<ZPLOutput onResizeMouseDown={() => undefined} />);
    expect(r.getByRole("button", { name: en.output.previewHeading })).toBeTruthy();
    cleanup();
    useLabelStore.setState({ previewProvider: "none" });
    const canvas = render(<ZPLOutput onResizeMouseDown={() => undefined} />);
    expect(canvas.queryByRole("button", { name: en.output.previewHeading })).toBeNull();
  });
});

describe("ZPLOutput output button", () => {
  it("opens the output dialog for the label from the bar", () => {
    useLabelStore.setState({ outputSource: null });
    const r = render(<ZPLOutput onResizeMouseDown={() => undefined} />);
    fireEvent.click(r.getByRole("button", { name: en.zebraPrint.outputHeading }));
    expect(useLabelStore.getState().outputSource).toBe("label");
  });

  it("stays disabled while a source-edit session is open and ignores a click", () => {
    useLabelStore.setState({ outputSource: null });
    useLabelStore.getState().enterSourceEdit("^XA^FO10,10^A0N,30,30^FDdraft^FS^XZ");
    const r = render(<ZPLOutput onResizeMouseDown={() => undefined} />);
    const button = r.getByRole("button", { name: en.zebraPrint.outputHeading }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(useLabelStore.getState().outputSource).toBeNull();
  });
});
