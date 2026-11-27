import { describe, it, expect } from "vitest";
import { checkDigitPreflight, validateEanUpc } from "./eanUpcValidate";

describe("validateEanUpc", () => {
  it("reports empty with the required data length", () => {
    expect(validateEanUpc("ean13", "")).toMatchObject({ status: "empty", dataLen: 12, remaining: 12 });
    expect(validateEanUpc("ean8", "")).toMatchObject({ status: "empty", dataLen: 7 });
    expect(validateEanUpc("upca", "")).toMatchObject({ status: "empty", dataLen: 11 });
    expect(validateEanUpc("upce", "")).toMatchObject({ status: "empty", dataLen: 6 });
  });

  it("counts down remaining digits while short", () => {
    expect(validateEanUpc("ean13", "12345")).toMatchObject({ status: "short", remaining: 7 });
    expect(validateEanUpc("upca", "0123456789")).toMatchObject({ status: "short", remaining: 1 });
  });

  it("computes the check digit and full code when complete", () => {
    // EAN-13 weights (1,3): 590123412345 -> check 7.
    expect(validateEanUpc("ean13", "590123412345")).toMatchObject({
      status: "complete",
      checkDigit: "7",
      fullCode: "5901234123457",
    });
    // UPC-A weights (3,1): 01234567890 -> check 5.
    expect(validateEanUpc("upca", "01234567890")).toMatchObject({ status: "complete", checkDigit: "5" });
    // EAN-8 weights (3,1): 9638507 -> check 4.
    expect(validateEanUpc("ean8", "9638507")).toMatchObject({ status: "complete", checkDigit: "4" });
  });

  it("uses the compressed UPC-E check math", () => {
    const r = validateEanUpc("upce", "123456");
    expect(r.status).toBe("complete");
    expect(r.checkDigit).toMatch(/^\d$/);
    expect(r.fullCode).toBe("123456" + r.checkDigit);
  });

  it("strips non-digits before counting", () => {
    expect(validateEanUpc("ean8", "96-38 507x")).toMatchObject({ status: "complete", digits: "9638507" });
  });

  it("verifies a provided check digit at N+1 (imported full codes)", () => {
    // EAN-8 96385074 carries the valid check 4.
    expect(validateEanUpc("ean8", "96385074")).toMatchObject({ status: "complete", checkDigit: "4" });
    // Wrong check digit is flagged, not silently corrected to green.
    expect(validateEanUpc("ean8", "96385070")).toMatchObject({ status: "badCheck", expected: "4", got: "0" });
    expect(validateEanUpc("ean13", "5901234123457")).toMatchObject({ status: "complete" });
    expect(validateEanUpc("ean13", "5901234123450")).toMatchObject({ status: "badCheck", expected: "7", got: "0" });
  });

  it("rejects content longer than the full code", () => {
    expect(validateEanUpc("ean8", "963850749")).toMatchObject({ status: "tooLong" });
  });
});

describe("checkDigitPreflight", () => {
  const findings = checkDigitPreflight("ean13");

  it("warns when the typed check digit is not the one the printer computes", () => {
    expect(findings("5901234123450")).toEqual([{ kind: "checkDigitMismatch", detail: "0 ≠ 7" }]);
  });

  it.each(["5901234123457", "590123412345", "12345", "", "5901234-123450"])("stays quiet for %s", (content) => {
    expect(findings(content)).toEqual([]);
  });
});
