// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { qrcodePanel } from "./qrcode.panel";
import { datamatrixPanel } from "./datamatrix.panel";
import { qrcode } from "@zplab/core/registry/qrcode";
import { datamatrix } from "@zplab/core/registry/datamatrix";

afterEach(cleanup);

const maxOf = (container: HTMLElement, value: number) =>
  [...container.querySelectorAll("input")].find((i) => i.value === String(value))?.getAttribute("max");

describe("panel bounds", () => {
  it("clamp into the editor's range where the wire allows more", () => {
    const Qr = qrcodePanel.PropertiesPanel;
    const qr = render(<Qr obj={{ id: "q", type: "qrcode", x: 0, y: 0, rotation: 0, props: qrcode.defaultProps } as never} onChange={() => undefined} />);
    expect(maxOf(qr.container, qrcode.defaultProps.magnification)).toBe("10");
    const Dm = datamatrixPanel.PropertiesPanel;
    const dm = render(<Dm obj={{ id: "d", type: "datamatrix", x: 0, y: 0, rotation: 0, props: datamatrix.defaultProps } as never} onChange={() => undefined} />);
    expect(maxOf(dm.container, datamatrix.defaultProps.dimension)).toBe("12");
  });
});
