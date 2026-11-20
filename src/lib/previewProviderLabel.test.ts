import { describe, expect, it } from "vitest";
import { fallbackTranslations as en } from "../locales";
import { previewProviderChoices } from "./previewProviderLabel";

describe("previewProviderChoices", () => {
  const loc = en.printerSettings.preview;
  const printer = (offered: boolean, server: boolean) =>
    previewProviderChoices(en, { labelary: true, printer: offered }, { desktop: false, server }).find((c) => c.provider === "printer");

  it("names what would unlock the printer in this build, and nothing once it is offered", () => {
    expect(printer(false, false)).toMatchObject({ disabled: true, reason: loc.providerPrinterDesktopOnly });
    expect(printer(false, true)).toMatchObject({ disabled: true, reason: loc.providerPrinterServerOnly });
    expect(printer(true, true)).toEqual({ provider: "printer", label: loc.providerPrinter, disabled: false });
  });
});
