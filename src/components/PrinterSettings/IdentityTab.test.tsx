// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { IdentityTab } from "./IdentityTab";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);
beforeEach(() => {
  act(() => {
    useLabelStore.setState({ printerProfile: {} } as never);
  });
});

const loc = en.printerSettings.identity;

describe("IdentityTab ^MP mode protection tri-state", () => {
  it("pristine default renders no mode checkboxes and no set", () => {
    const { queryByText } = render(<IdentityTab />);
    expect(queryByText(loc.modeProtectDarkness)).toBeNull();
    expect(useLabelStore.getState().printerProfile.modeProtection).toBeUndefined();
  });

  it("entering Custom creates the visible empty set (explicit ^MPE)", () => {
    const { getByRole } = render(<IdentityTab />);
    act(() => {
      fireEvent.click(getByRole("button", { name: loc.modeProtectCustom }));
    });
    const p = useLabelStore.getState().printerProfile;
    expect(p.modeProtection).toEqual([]);
    expect(p.modeProtectionExplicit).toBe(true);
  });

  it("toggling inside Custom keeps [] visible instead of collapsing to unset", () => {
    const { getByRole, getByText } = render(<IdentityTab />);
    act(() => {
      fireEvent.click(getByRole("button", { name: loc.modeProtectCustom }));
    });
    const box = () => getByText(loc.modeProtectDarkness);
    act(() => {
      fireEvent.click(box());
    });
    expect(useLabelStore.getState().printerProfile.modeProtection).toEqual(["D"]);
    act(() => {
      fireEvent.click(box());
    });
    expect(useLabelStore.getState().printerProfile.modeProtection).toEqual([]);
  });

  it("returning to Default clears set and explicit flag (no fabricated ^MPE)", () => {
    act(() => {
      useLabelStore.setState({
        printerProfile: { modeProtection: ["D"], modeProtectionExplicit: true },
      } as never);
    });
    const { getByRole } = render(<IdentityTab />);
    act(() => {
      fireEvent.click(getByRole("button", { name: en.printerSettings.defaultOption }));
    });
    const p = useLabelStore.getState().printerProfile;
    expect(p.modeProtection).toBeUndefined();
    expect(p.modeProtectionExplicit).toBeUndefined();
  });

  it("an imported relative set shows as Custom and becomes absolute on touch", () => {
    act(() => {
      useLabelStore.setState({ printerProfile: { modeProtection: ["D"] } } as never);
    });
    const { getByText } = render(<IdentityTab />);
    act(() => {
      fireEvent.click(getByText(loc.modeProtectFeed));
    });
    const p = useLabelStore.getState().printerProfile;
    expect(p.modeProtection).toEqual(["D", "F"]);
    expect(p.modeProtectionExplicit).toBe(true);
  });
});
