// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { PreviewSettingsTab } from "./PreviewSettingsTab";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);

beforeEach(() => {
  act(() => {
    useLabelStore.setState({ previewProvider: "labelary", thirdParty: { labelary: true }, labelaryNoticeAcknowledged: true, labelaryHost: "" });
  });
});

const loc = en.printerSettings.preview;

describe("PreviewSettingsTab", () => {
  it("switches the renderer off and keeps the Labelary consent in reach", () => {
    const r = render(<PreviewSettingsTab />);
    act(() => {
      fireEvent.click(r.getByLabelText(loc.providerNone));
    });
    expect(useLabelStore.getState().previewProvider).toBe("none");
    expect(r.getByLabelText(loc.labelaryConsent)).toBeTruthy();
    expect(r.queryByText(loc.apiHeading)).toBeNull();
    expect(r.getByText(loc.labelaryIdleHint, { exact: false })).toBeTruthy();
    expect(r.queryByText(en.output.previewNoticeBody, { exact: false })).toBeNull();
  });

  it("keeps the notice when a stored printer way falls back to Labelary on the web", () => {
    act(() => useLabelStore.setState({ previewProvider: "printer" }));
    const r = render(<PreviewSettingsTab />);
    expect(r.getByText(en.output.previewNoticeBody, { exact: false })).toBeTruthy();
    expect(r.queryByText(loc.labelaryIdleHint, { exact: false })).toBeNull();
  });

  it("shows the stored choice and says a build without Labelary has no renderer", () => {
    act(() => {
      useLabelStore.setState({ thirdParty: { labelary: false } });
    });
    const r = render(<PreviewSettingsTab />);
    expect((r.getByLabelText(loc.providerLabelary) as HTMLInputElement).checked).toBe(true);
    expect(r.getByText(`Currently active: ${loc.providerNone}`)).toBeTruthy();
    expect(r.queryByText(loc.privacyHeading)).toBeNull();
  });
});
