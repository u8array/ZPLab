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
