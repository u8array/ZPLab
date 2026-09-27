// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { StoredFormatField } from "./StoredFormatField";
import { fallbackTranslations as en } from "../../locales";
import type { StoredFormatDelivery } from "@zplab/core/types/LabelConfig";
import type { RecallWayIssue } from "@zplab/core/lib/zplGenerator";

afterEach(cleanup);

function Spy({ initial, way, issue, log, ways = [] }: { initial?: string; way?: StoredFormatDelivery; issue?: RecallWayIssue; log: (string | undefined)[]; ways?: (string | undefined)[] }) {
  const [path, setPath] = useState<string | undefined>(initial);
  const [delivery, setDelivery] = useState<StoredFormatDelivery | undefined>(way);
  return (
    <StoredFormatField
      path={path}
      delivery={delivery}
      issue={issue}
      locked={false}
      onChange={(next) => {
        log.push(next);
        setPath(next);
      }}
      onDeliveryChange={(way) => {
        ways.push(way);
        setDelivery(way);
      }}
    />
  );
}

const nameInput = (r: ReturnType<typeof render>) => r.container.querySelector("input") as HTMLInputElement;

describe("StoredFormatField", () => {
  it("writes a drive, a sanitized name and the fixed extension", () => {
    const log: (string | undefined)[] = [];
    const r = render(<Spy log={log} />);
    fireEvent.change(nameInput(r), { target: { value: "job-1 x" } });
    expect(log).toEqual(["E:JOB1X.ZPL"]);
    expect(nameInput(r).value).toBe("JOB1X");
  });

  it("caps the name at what ^DF stores, keeps a long imported name, and clears the field on an empty name", () => {
    const log: (string | undefined)[] = [];
    const r = render(<Spy initial="R:ABCDEFGHIJKL.ZPL" log={log} />);
    expect(nameInput(r).value).toBe("ABCDEFGHIJKL");
    fireEvent.change(nameInput(r), { target: { value: "ABCDEFGHIJKLMNOPQ" } });
    fireEvent.change(nameInput(r), { target: { value: "" } });
    expect(log).toEqual(["R:ABCDEFGHIJKLMNOP.ZPL", undefined]);
  });

  it("offers the delivery only beside a name", () => {
    const none = render(<Spy log={[]} />);
    expect(none.queryByRole("button", { name: /^Delivery/ })).toBeNull();
    cleanup();
    const named = render(<Spy initial="E:JOB.ZPL" log={[]} />);
    expect(named.getByRole("button", { name: /^Delivery/ })).toBeTruthy();
  });

  it("hands the chosen way to the page", () => {
    const ways: (string | undefined)[] = [];
    const r = render(<Spy initial="E:JOB.ZPL" log={[]} ways={ways} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: /^Delivery/ }));
    });
    act(() => {
      r.getByRole("option", { name: "Once in the setup script" }).click();
    });
    act(() => {
      fireEvent.click(r.getByRole("button", { name: /^Delivery/ }));
    });
    act(() => {
      r.getByRole("option", { name: "With every job" }).click();
    });
    expect(ways).toEqual(["setup", undefined]);
  });

  it("blocks the recall ways for a name ^XF cannot read", () => {
    const long = render(<Spy initial="E:VERYLONGNAME12.ZPL" issue="longName" log={[]} />);
    act(() => {
      fireEvent.click(long.getByRole("button", { name: /^Delivery/ }));
    });
    expect(long.getByRole("option", { name: "Once in the setup script" }).getAttribute("aria-disabled")).toBe("true");
    expect(long.getByRole("option", { name: "Already on the printer" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("blocks the recall ways for a name another page stores under, and flags a way already chosen", () => {
    const fresh = render(<Spy initial="E:JOB.ZPL" issue="contested" log={[]} />);
    expect(fresh.queryByText(en.delivery.formatNameContested)).toBeNull();
    act(() => {
      fireEvent.click(fresh.getByRole("button", { name: /^Delivery/ }));
    });
    expect(fresh.getByRole("option", { name: "Once in the setup script" }).getAttribute("aria-disabled")).toBe("true");
    cleanup();
    const chosen = render(<Spy initial="E:JOB.ZPL" way="setup" issue="contested" log={[]} />);
    expect(chosen.getByText(en.delivery.formatNameContested)).toBeTruthy();
  });

  it("explains the field in a tooltip on the label, not in a paragraph", () => {
    const r = render(<Spy log={[]} />);
    expect(r.queryByText(en.label.storedFormatHint)).toBeNull();
    act(() => {
      fireEvent.focus(r.getByText(en.label.storedFormat));
    });
    expect(r.getByRole("tooltip").textContent).toBe(en.label.storedFormatHint);
  });
});
