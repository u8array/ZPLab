// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act, within } from "@testing-library/react";
import { SensorsTab } from "./SensorsTab";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);
beforeEach(() => {
  act(() => {
    useLabelStore.setState({ printerProfile: {} });
  });
});

const loc = en.printerSettings.sensors;
const profile = () => useLabelStore.getState().printerProfile;

describe("SensorsTab", () => {
  it("writes one ^SS slot, clamps a value past its range, and clears the slot again", () => {
    const { getByLabelText } = render(<SensorsTab />);
    const web = getByLabelText(loc.web);
    fireEvent.change(web, { target: { value: "75" } });
    fireEvent.blur(web);
    expect(profile()).toEqual({ sensorWebThreshold: 75 });
    fireEvent.change(web, { target: { value: "300" } });
    fireEvent.blur(web);
    expect(profile()).toEqual({ sensorWebThreshold: 100 });
    fireEvent.change(web, { target: { value: "" } });
    fireEvent.blur(web);
    expect(profile()).toEqual({});
  });

  it("warns while dynamic calibration would replace a typed value", () => {
    const { getByLabelText, getByRole, queryByText, getByText } = render(<SensorsTab />);
    expect(queryByText(loc.recalibrateWarning)).toBeNull();
    const web = getByLabelText(loc.web);
    fireEvent.change(web, { target: { value: "75" } });
    fireEvent.blur(web);
    expect(getByText(loc.recalibrateWarning)).toBeTruthy();
    for (const name of [loc.dynamicLength, loc.dynamicThreshold]) fireEvent.click(within(getByRole("group", { name })).getByRole("button", { name: loc.dynamicOff }));
    expect(getByText(loc.recalibrateWarning)).toBeTruthy();
    fireEvent.click(within(getByRole("group", { name: loc.dynamicGain })).getByRole("button", { name: loc.dynamicOff }));
    expect(queryByText(loc.recalibrateWarning)).toBeNull();
  });

  it("takes the sensor choice and the printhead resistance", () => {
    const { getByRole, getByLabelText } = render(<SensorsTab />);
    fireEvent.click(getByRole("button", { name: loc.sensorSelect }));
    fireEvent.click(getByRole("option", { name: new RegExp(loc.sensorSelectT) }));
    expect(profile().mediaSensorSelect).toBe("T");
    const resistance = getByLabelText(loc.resistance);
    fireEvent.change(resistance, { target: { value: "675" } });
    fireEvent.blur(resistance);
    expect(profile().printheadResistance).toBe(675);
  });

  it("switches dynamic length calibration off and back to the printer default", () => {
    const { getByRole } = render(<SensorsTab />);
    const group = within(getByRole("group", { name: loc.dynamicLength }));
    fireEvent.click(group.getByRole("button", { name: loc.dynamicOff }));
    expect(profile()).toEqual({ dynamicCalibrationLength: "N" });
    fireEvent.click(group.getByRole("button", { name: loc.dynamicDefaultOn }));
    expect(profile()).toEqual({});
  });
});
