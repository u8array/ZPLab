// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { InterfacesTab } from "./InterfacesTab";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);
beforeEach(() => {
  act(() => {
    useLabelStore.setState({ printerProfile: {} });
  });
});

const loc = en.printerSettings.interfaces;
const profile = () => useLabelStore.getState().printerProfile;
const pick = (r: ReturnType<typeof render>, field: string, option: string | RegExp) => {
  fireEvent.click(r.getByRole("button", { name: field }));
  fireEvent.click(r.getByRole("option", { name: option }));
};

describe("InterfacesTab", () => {
  it("builds the serial port slot by slot and clears the field with the last slot", () => {
    const r = render(<InterfacesTab />);
    pick(r, loc.parity, new RegExp(loc.parityE));
    pick(r, loc.baud, "9600");
    expect(profile().serialPort).toEqual({ baud: "9600", parity: "E" });
    pick(r, loc.baud, loc.notSet);
    pick(r, loc.parity, loc.notSet);
    expect(profile()).toEqual({});
  });

  it("fills the six serial slots from a preset and says so while the port is incomplete", () => {
    const r = render(<InterfacesTab />);
    expect(r.getByRole("button", { name: en.label.preset }).textContent).toContain(loc.notSet);
    pick(r, loc.baud, "9600");
    expect(r.getByText(loc.serialIncomplete)).toBeTruthy();
    expect(r.getByRole("button", { name: en.label.preset }).textContent).toContain(en.label.presetCustom);
    pick(r, en.label.preset, /^115200 8N1/);
    expect(profile().serialPort).toEqual({ baud: "115200", dataBits: "8", parity: "N", stopBits: "1", handshake: "X", protocol: "N" });
    expect(r.queryByText(loc.serialIncomplete)).toBeNull();
    fireEvent.click(r.getByRole("button", { name: en.label.preset }));
    expect(r.queryByRole("option", { name: en.label.presetCustom })).toBeNull();
    expect(r.queryByRole("option", { name: loc.notSet })).toBeNull();
  });

  it("sets one applicator slot on its own once the port is shown", () => {
    const r = render(<InterfacesTab />);
    expect(r.queryByRole("button", { name: loc.startPrint })).toBeNull();
    fireEvent.click(r.getByRole("button", { name: loc.auxShow }));
    pick(r, loc.startPrint, new RegExp(loc.startPrintL));
    expect(profile()).toEqual({ auxPortStartPrint: "l" });
    expect(r.queryByRole("button", { name: loc.auxHide })).toBeNull();
    pick(r, loc.startPrint, en.printerSettings.defaultOption);
    expect(profile()).toEqual({});
  });
});
