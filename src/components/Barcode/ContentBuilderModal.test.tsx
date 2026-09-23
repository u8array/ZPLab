// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ContentBuilderModal } from "./ContentBuilderModal";
import { useLabelStore } from "../../store/labelStore";
import { VCARD_FIELDS } from "@zplab/core/lib/typedContent";
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

describe("ContentBuilderModal contact fields", () => {
  it("offers every contact field with a real label", () => {
    useLabelStore.setState({
      pages: [{ objects: [{ ...(qr as { props: object }), props: { ...(qr as { props: object }).props, content: "BEGIN:VCARD\nVERSION:3.0\nN:B;A;;;\nEND:VCARD" } }] }],
    } as never);
    render(<ContentBuilderModal />);
    const labels = en.contentBuilder as Record<string, string>;
    for (const key of VCARD_FIELDS) {
      const label = labels[`f${key.charAt(0).toUpperCase()}${key.slice(1)}`];
      expect(label, key).toBeDefined();
      expect(screen.getByRole("textbox", { name: label })).toBeTruthy();
    }
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
