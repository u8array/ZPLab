// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ContentBuilderModal } from "./ContentBuilderModal";
import { useLabelStore } from "../../store/labelStore";

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

describe("ContentBuilderModal WiFi password", () => {
  it("is a marker field like the SSID, since the value prints in the code", () => {
    const { container } = render(<ContentBuilderModal />);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    const field = screen.getByRole("textbox", { name: "Password" });
    expect(field.getAttribute("contenteditable")).toBe("true");
    expect(field.querySelector('[data-m="«pw»"]')).not.toBeNull();
  });
});
