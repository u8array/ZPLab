// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { AppSettingsTab } from "./AppSettingsTab";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";

afterEach(() => {
  cleanup();
  act(() => {
    useLabelStore.setState({ appUpdate: { phase: "idle" } });
  });
});

const loc = en.printerSettings.app;

describe("AppSettingsTab updates", () => {
  it("points a packaged install at the Store and hides the check button", () => {
    act(() => {
      useLabelStore.setState({ appUpdate: { phase: "unsupported" } });
    });
    const { getByText, queryByText } = render(<AppSettingsTab />);
    expect(getByText(loc.updatesViaStore)).toBeTruthy();
    expect(queryByText(loc.checkUpdates)).toBeNull();
  });

  it("says nothing about the Store when the app updates itself", () => {
    const { queryByText } = render(<AppSettingsTab />);
    expect(queryByText(loc.updatesViaStore)).toBeNull();
  });
});
