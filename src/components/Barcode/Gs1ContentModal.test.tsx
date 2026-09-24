// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";
import { Gs1ContentModal } from "./Gs1ContentModal";
import { useLabelStore } from "../../store/labelStore";
import { gtin14WithCheck, GS1_GS } from "@zplab/core/lib/gs1";

afterEach(cleanup);

const GTIN = gtin14WithCheck("0001234567890");
const barcode = { id: "b", type: "code128", x: 0, y: 0, rotation: 0, props: { content: "", gs1Mode: true } } as never;

const seedContent = (content: string) =>
  useLabelStore.setState({
    pages: [{ objects: [{ ...(barcode as { props: object }), props: { ...(barcode as { props: object }).props, content } }] }],
    currentPageIndex: 0,
    variables: [],
    gs1BuilderObjectId: "b",
  } as never);

beforeEach(() => seedContent(""));

const objectContent = () =>
  (useLabelStore.getState().pages[0]?.objects[0] as { props: { content: string } }).props.content;
const paletteButton = (ai: string, name: string) => screen.getByRole("button", { name: `(${ai})${name}` });
const paletteHas = (ai: string, name: string) => screen.queryByRole("button", { name: `(${ai})${name}` }) !== null;
const search = (text: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: "Search identifiers…" }), { target: { value: text } });
const valueOf = (name: string) => screen.getByRole("textbox", { name }).textContent;
const typeInto = (name: string, text: string) => {
  const field = screen.getByRole("textbox", { name });
  field.textContent = text;
  fireEvent.input(field);
};

describe("Gs1ContentModal", () => {
  it("seeds the rows from the object's content and applies the element string", () => {
    seedContent(`01${GTIN}10LOT1`);
    render(<Gs1ContentModal />);
    expect(valueOf("GTIN")).toBe(GTIN);
    expect(valueOf("Batch / lot")).toBe("LOT1");
    typeInto("Batch / lot", "LOT2");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(objectContent()).toBe(`01${GTIN}10LOT2`);
    expect(useLabelStore.getState().gs1BuilderObjectId).toBeNull();
  });

  it("adds an identifier from the palette, focuses its value and blocks adding it twice", () => {
    seedContent(`01${GTIN}`);
    render(<Gs1ContentModal />);
    fireEvent.click(paletteButton("10", "Batch / lot"));
    const lot = screen.getByRole("textbox", { name: "Batch / lot" });
    expect(document.activeElement).toBe(lot);
    expect((paletteButton("10", "Batch / lot") as HTMLButtonElement).disabled).toBe(true);
    expect((paletteButton("01", "GTIN") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers the curated set until a search spans the catalog", () => {
    render(<Gs1ContentModal />);
    expect(paletteHas("8111", "Loyalty points")).toBe(false);
    expect(screen.getByText(/more identifiers via search/)).toBeTruthy();
    search("8111");
    expect(paletteHas("8111", "Loyalty points")).toBe(true);
    expect(screen.queryByText(/more identifiers via search/)).toBeNull();
  });

  it("hides identifiers a strict carrier cannot satisfy and enforces their requisites", () => {
    useLabelStore.setState({
      pages: [{ objects: [{ ...(barcode as object), type: "gs1databar", props: { content: "375" } }] }],
    } as never);
    render(<Gs1ContentModal />);
    search("8111");
    expect(paletteHas("8111", "Loyalty points")).toBe(false);
    expect(screen.getAllByText("(37) requires (00)+(02) / (00)+(8026) in the same barcode")).toHaveLength(2);
  });

  it("keeps a strict carrier's gates after the target is removed under the modal", () => {
    useLabelStore.setState({
      pages: [{ objects: [{ ...(barcode as object), type: "gs1databar", props: { content: "375" } }] }],
      selectedIds: ["b"],
    } as never);
    render(<Gs1ContentModal />);
    act(() => useLabelStore.getState().removeSelectedObjects());
    search("8111");
    expect(paletteHas("8111", "Loyalty points")).toBe(false);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("badges each row with its format and names a marker that resolves too short", () => {
    seedContent(`01${GTIN}`);
    useLabelStore.setState({ variables: [{ id: "v", name: "EXP", fnNumber: 3, defaultValue: "2024" }] } as never);
    render(<Gs1ContentModal />);
    expect(screen.getByText("✓ n14")).toBeTruthy();
    fireEvent.click(paletteButton("17", "Expiry date"));
    typeInto("Expiry date", "«EXP»");
    expect(screen.getByText("✗ 4/6")).toBeTruthy();
    expect(screen.getByText("Resolves to 4 of 6 required characters. Adjust the variable's default value.")).toBeTruthy();
    typeInto("Expiry date", "251231");
    search("3102");
    fireEvent.click(paletteButton("3102", "Net weight (kg)"));
    typeInto("Net weight (kg)", "001234");
    expect(screen.getByText("✓ n4+2")).toBeTruthy();
    expect(screen.getByText("= 12.34")).toBeTruthy();
  });

  it("previews the element string and the ZPL payload once the set is valid", () => {
    seedContent(`01${GTIN}`);
    useLabelStore.setState({ variables: [{ id: "v", name: "LOT", fnNumber: 7, defaultValue: "L9" }] } as never);
    render(<Gs1ContentModal />);
    fireEvent.click(paletteButton("10", "Batch / lot"));
    typeInto("Batch / lot", "«LOT»");
    expect(Array.from(document.querySelectorAll("code")).map((c) => c.textContent)).toEqual([`(01)${GTIN}(10)L9`, `(01)${GTIN}(10)#7#`]);
  });

  it("separates a variable-length value from the next segment", () => {
    seedContent(`01${GTIN}10LOT1${GS1_GS}21SER`);
    render(<Gs1ContentModal />);
    expect(screen.getAllByText("FNC1")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(objectContent()).toBe(`01${GTIN}10LOT1${GS1_GS}21SER`);
  });

  it("names the first blocker in the footer and holds Apply", () => {
    seedContent(`01${GTIN}`);
    render(<Gs1ContentModal />);
    typeInto("GTIN", "12A");
    expect(screen.getByRole("status").textContent).toBe("1 field(s) with errors");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("status").textContent).toBe("Add at least one segment");
  });

  it("prefills the list from a preset when it starts empty", () => {
    render(<Gs1ContentModal />);
    fireEvent.click(screen.getByRole("button", { name: /Batch & expiry/ }));
    expect(screen.getByRole("textbox", { name: "GTIN" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Batch / lot" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Expiry date" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "GTIN" }));
  });

  it("keeps content it cannot load as segments until Apply", () => {
    seedContent("free text");
    render(<Gs1ContentModal />);
    expect(screen.getByText(/couldn't be loaded as segments/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(objectContent()).toBe("free text");
  });
});
