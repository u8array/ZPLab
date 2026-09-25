// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { ContentBuilderModal } from "./ContentBuilderModal";
import { useLabelStore } from "../../store/labelStore";
import { MECARD_FIELDS, VCARD_FIELDS } from "@zplab/core/lib/typedContent";
import en from "../../locales/en";

afterEach(cleanup);

const qr = {
  id: "q",
  type: "qrcode",
  x: 10,
  y: 10,
  rotation: 0,
  props: { content: "WIFI:S:office;T:WPA;P:«pw»;;", model: 2, magnification: 4, errorCorrection: "M" },
} as never;

beforeEach(() => {
  useLabelStore.setState({
    pages: [{ objects: [qr] }],
    currentPageIndex: 0,
    variables: [{ id: "v1", name: "pw", fnNumber: 1, defaultValue: "s3cret" }],
    contentBuilderObjectId: "q",
  } as never);
});

const seedContent = (content: string) =>
  useLabelStore.setState({
    pages: [{ objects: [{ ...(qr as { props: object }), props: { ...(qr as { props: object }).props, content } }] }],
  } as never);
const objectContent = () => (useLabelStore.getState().pages[0]?.objects[0] as { props: { content: string } }).props.content;
const fieldLabel = (key: string) => (en.contentBuilder as Record<string, string>)[`f${key.charAt(0).toUpperCase()}${key.slice(1)}`];

describe("ContentBuilderModal contact fields", () => {
  it("offers every contact field with a real label", () => {
    seedContent("BEGIN:VCARD\nVERSION:3.0\nN:B;A;;;\nEND:VCARD");
    render(<ContentBuilderModal />);
    for (const key of VCARD_FIELDS) {
      expect(fieldLabel(key), key).toBeDefined();
      expect(screen.getByRole("textbox", { name: fieldLabel(key) })).toBeTruthy();
    }
  });

  it("is a native autofill input until the first marker lands, then stays the chip editor", () => {
    seedContent("BEGIN:VCARD\nVERSION:3.0\nN:B;«pw»;;;\nEND:VCARD");
    render(<ContentBuilderModal />);
    const last = screen.getByRole("textbox", { name: "Last name" });
    expect(last.tagName).toBe("INPUT");
    expect(last.getAttribute("autocomplete")).toBe("family-name");
    expect((last as HTMLInputElement).value).toBe("B");
    expect(screen.getByRole("textbox", { name: "First name" }).getAttribute("contenteditable")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Note" }).getAttribute("contenteditable")).toBe("true");

    (last as HTMLInputElement).setSelectionRange(0, 0);
    fireEvent.click(within(last.parentElement!).getByRole("button"));
    fireEvent.click(within(screen.getByRole("menu")).getAllByRole("button")[0]!);
    const chip = screen.getByRole("textbox", { name: "Last name" });
    expect(chip.getAttribute("contenteditable")).toBe("true");
    expect(chip.querySelector('[data-m="«pw»"]')).not.toBeNull();
    expect(chip.textContent?.endsWith("B")).toBe(true);
    expect(document.activeElement).toBe(chip);
  });

  it("keeps the focus when a marker is typed into the native field", () => {
    seedContent("BEGIN:VCARD\nVERSION:3.0\nN:B;A;;;\nEND:VCARD");
    render(<ContentBuilderModal />);
    const org = screen.getByRole("textbox", { name: "Organization" });
    org.focus();
    fireEvent.change(org, { target: { value: "«pw»" } });
    const chip = screen.getByRole("textbox", { name: "Organization" });
    expect(chip.getAttribute("contenteditable")).toBe("true");
    expect(document.activeElement).toBe(chip);
  });

  it("starts each content type's field fresh, so a chip in one type leaves the other native", () => {
    seedContent("BEGIN:VCARD\nVERSION:3.0\nN:«pw»;A;;;\nEND:VCARD");
    render(<ContentBuilderModal />);
    expect(screen.getByRole("textbox", { name: "Last name" }).getAttribute("contenteditable")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "MECARD" }));
    expect(screen.getByRole("textbox", { name: "Last name" }).tagName).toBe("INPUT");
    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    expect(screen.getByRole("textbox", { name: "URL" }).getAttribute("contenteditable")).toBe("true");
  });

  it("seeds the GS1 Digital Link editor from a link and writes the link back", () => {
    seedContent("https://id.gs1.org/01/09506000134352/10/ABC?17=250101");
    render(<ContentBuilderModal />);
    expect(screen.getByRole("button", { name: en.contentBuilder.typeGs1link, pressed: true })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: fieldLabel("domain") })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Batch / lot" }).textContent).toBe("ABC");
    expect(screen.getByRole("textbox", { name: "Expiry date" }).textContent).toBe("250101");
    expect(screen.queryByText("FNC1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "(21)Serial number" }));
    const serial = screen.getByRole("textbox", { name: "Serial number" });
    serial.textContent = "S1";
    fireEvent.input(serial);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(objectContent()).toBe("https://id.gs1.org/01/09506000134352/10/ABC/21/S1?17=250101");
  });

  it("names the AI rule a link row breaks and refuses a second key in the palette", () => {
    seedContent("https://id.gs1.org/01/09506000134352?3103=12");
    render(<ContentBuilderModal />);
    expect(screen.getByRole("textbox", { name: "Net weight (kg)" }).textContent).toBe("12");
    expect(screen.getAllByText(new RegExp(en.gs1builder.errExactLength)).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "(00)SSCC" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "(10)Batch / lot" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps an invalid row across a type switch and names the missing key", () => {
    seedContent("https://id.gs1.org/01/09506000134352/10/ABC");
    render(<ContentBuilderModal />);
    const lot = screen.getByRole("textbox", { name: "Batch / lot" });
    lot.textContent = "A(B";
    fireEvent.input(lot);
    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    fireEvent.click(screen.getByRole("button", { name: en.contentBuilder.typeGs1link }));
    expect(screen.getByRole("textbox", { name: "GTIN" }).textContent).toBe("09506000134352");
    expect(screen.getByRole("textbox", { name: "Batch / lot" }).textContent).toBe("A(B");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    const kept = screen.getByRole("textbox", { name: "Batch / lot" });
    kept.textContent = "ABC";
    fireEvent.input(kept);
    expect(screen.getByText(en.contentBuilder.errGs1NoKey)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a marker in the domain through Apply and reopen", () => {
    seedContent("https://«pw»/01/09506000134352");
    for (let i = 0; i < 2; i++) {
      useLabelStore.setState({ contentBuilderObjectId: "q" } as never);
      render(<ContentBuilderModal />);
      expect(screen.getByRole("textbox", { name: fieldLabel("domain") }).querySelector('[data-m="«pw»"]')).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(objectContent()).toBe("https://«pw»/01/09506000134352");
      cleanup();
    }
  });

  it("keeps a link's text one tab away on the URL type", () => {
    seedContent("https://id.gs1.org/01/09506000134352");
    render(<ContentBuilderModal />);
    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    expect(screen.getByRole("textbox", { name: "URL" }).textContent).toBe("https://id.gs1.org/01/09506000134352");
  });

  it("shows the default resolver as the domain's placeholder", () => {
    seedContent("https://id.gs1.org/01/09506000134352");
    render(<ContentBuilderModal />);
    expect(screen.getByRole("textbox", { name: fieldLabel("domain") }).getAttribute("data-placeholder")).toBe("https://id.gs1.org");
  });

  it("keeps a complete link GTIN at its own length and shows its printed form", () => {
    seedContent("https://id.gs1.org/01/9506000134352");
    render(<ContentBuilderModal />);
    expect(screen.getByRole("textbox", { name: "GTIN" }).textContent).toBe("9506000134352");
    expect(screen.queryByText(en.gs1builder.gtinAutocomplete)).toBeNull();
    expect(screen.getByText("= 09506000134352")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("holds Apply on a value that looks like a tag and names a pasted second key", () => {
    seedContent("https://id.gs1.org/01/09506000134352/10/ABC");
    render(<ContentBuilderModal />);
    const lot = screen.getByRole("textbox", { name: "Batch / lot" });
    lot.textContent = "A(11)250101";
    fireEvent.input(lot);
    expect(screen.getAllByText(new RegExp(en.gs1builder.errCharset)).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    seedContent("https://id.gs1.org/01/09506000134352?00=123456789012345675");
    render(<ContentBuilderModal />);
    expect(screen.getByText(en.contentBuilder.errGs1TwoKeys)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("seeds the MECARD form from parsed content", () => {
    seedContent("MECARD:N:B,A;;");
    render(<ContentBuilderModal />);
    expect((en.contentBuilder as Record<string, string>).typeMecard).toBeDefined();
    for (const key of MECARD_FIELDS) {
      expect(fieldLabel(key), key).toBeDefined();
      expect(screen.getByRole("textbox", { name: fieldLabel(key) })).toBeTruthy();
    }
    expect(screen.getByRole("textbox", { name: "First name" })).toHaveProperty("value", "A");
  });
});

describe("ContentBuilderModal WiFi password", () => {
  it("is a marker field like the SSID, since the value prints in the code", () => {
    const { container } = render(<ContentBuilderModal />);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    const field = screen.getByRole("textbox", { name: "Password" });
    expect(field.getAttribute("contenteditable")).toBe("true");
    expect(field.querySelector('[data-m="«pw»"]')).not.toBeNull();
  });
});
