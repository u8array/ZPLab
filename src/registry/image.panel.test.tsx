// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { imagePanel } from "./image.panel";
import { useLabelStore } from "../store/labelStore";
import type { ImageProps } from "@zplab/core/registry/image";
import type { LabelObjectBase } from "@zplab/core/types/LabelObject";
import type * as ImageRegistry from "@zplab/core/registry/image";

const { verdict } = vi.hoisted(() => ({ verdict: vi.fn<() => { fit: "tooLarge" | "unshippable" } | undefined>(() => undefined) }));
vi.mock("@zplab/core/registry/image", async (importOriginal) => {
  const real = await importOriginal<typeof ImageRegistry>();
  return { ...real, setupGraphicOf: (p: Parameters<typeof real.setupGraphicOf>[0]) => verdict() ?? real.setupGraphicOf(p) };
});

const GFA = "^GFA,4,4,1,00FFFF00";
const stored = (extra: Partial<ImageProps["storedAs"]> = {}): LabelObjectBase & { props: ImageProps } => ({
  id: "img-1",
  type: "image",
  x: 0,
  y: 0,
  rotation: 0,
  props: { imageId: "", widthDots: 8, heightDots: 4, threshold: 128, _gfaCache: GFA, storedAs: { device: "R", name: "LOGO", ...extra } },
});

const Panel = imagePanel.PropertiesPanel;
const choose = (r: ReturnType<typeof render>, option: string) => {
  act(() => {
    fireEvent.click(r.getByRole("button", { name: /^Delivery/ }));
  });
  act(() => {
    r.getByRole("option", { name: option }).click();
  });
};

beforeEach(() => {
  useLabelStore.temporal.getState().clear();
  act(() => useLabelStore.setState({ printerProfile: {} }));
});
afterEach(() => {
  cleanup();
  act(() => useLabelStore.setState({ printerProfile: {} }));
});

const option = (r: ReturnType<typeof render>, name: string) => {
  act(() => {
    fireEvent.click(r.getByRole("button", { name: /^Delivery/ }));
  });
  return r.getByRole("option", { name }) as HTMLElement;
};

describe("image panel delivery", () => {
  it("copies the bytes into the profile and leaves the label recall-only when setup is chosen", () => {
    const onChange = vi.fn();
    const r = render(<Panel obj={stored()} onChange={onChange} />);
    choose(r, "Once in the setup script");
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:LOGO.GRF", gfa: GFA }]);
    expect(onChange).toHaveBeenCalledWith({ storedAs: { device: "R", name: "LOGO", embedInZpl: false }, _gfaCache: GFA });
  });

  it("reads the printer for a recall nothing provisions, and drops the entry when the printer is chosen", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const onChange = vi.fn();
    const r = render(<Panel obj={stored({ embedInZpl: false })} onChange={onChange} />);
    expect(r.getByRole("button", { name: /^Delivery/ }).textContent).toContain("Once in the setup script");
    choose(r, "Already on the printer");
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(r.getByText(/nothing prints in its place/)).toBeTruthy();
  });

  it("keeps the select for a recall spelled .PNG", () => {
    const onChange = vi.fn();
    const r = render(<Panel obj={stored({ embedInZpl: false, ext: "PNG" })} onChange={onChange} />);
    expect(r.getByRole("button", { name: /^Delivery/ }).textContent).toContain("Already on the printer");
    choose(r, "Once in the setup script");
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:LOGO.GRF", gfa: GFA }]);
    expect(onChange).toHaveBeenCalledWith({ storedAs: { device: "R", name: "LOGO", embedInZpl: false }, _gfaCache: GFA });
  });

  it("blocks the job and says so when no bytes could ship, whatever the flag says", () => {
    const obj = stored();
    const r = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: undefined } }} onChange={() => undefined} />);
    expect(r.getByText(/Needs the image data/)).toBeTruthy();
    expect(option(r, "With every job").getAttribute("aria-disabled")).toBe("true");
  });

  it("writes nothing on a re-pick of the current way", () => {
    const onChange = vi.fn();
    const r = render(<Panel obj={stored()} onChange={onChange} />);
    choose(r, "With every job");
    expect(onChange).not.toHaveBeenCalled();
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });

  it("hands off from the setup-script hint to the stored graphics tab", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const { getByText } = render(<Panel obj={stored({ embedInZpl: false })} onChange={() => undefined} />);
    act(() => {
      fireEvent.click(getByText(/Manage stored objects/));
    });
    expect(useLabelStore.getState().printerSettingsTab).toBe("storedGraphics");
    act(() => useLabelStore.setState({ printerSettingsTab: null }));
  });

  it("shows a refused encode until the object's bytes change", () => {
    const obj = stored();
    const r = render(<Panel obj={obj} onChange={() => undefined} />);
    verdict.mockReturnValueOnce({ fit: "unshippable" });
    choose(r, "Once in the setup script");
    expect(r.getByText(/Too wide/)).toBeTruthy();
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
    r.rerender(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: "^GFA,4,4,1,FFFFFFFF" } }} onChange={() => undefined} />);
    expect(r.queryByText(/Too wide/)).toBeNull();
    expect(option(r, "Once in the setup script").getAttribute("aria-disabled")).toBeNull();
  });

  it("keeps setup selectable while an entry exists, names its state, and blocks setup only when an encode is due", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const obj = stored({ embedInZpl: false });
    const gone = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: undefined } }} onChange={() => undefined} />);
    expect(gone.getByText(/not verifiable/)).toBeTruthy();
    expect(option(gone, "Once in the setup script").getAttribute("aria-disabled")).toBeNull();
    cleanup();
    const huge = `^GFA,600000,600000,1,${"F".repeat(1_200_000)}`;
    const big = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: huge } }} onChange={() => undefined} />);
    expect(big.getByText(/Too large/)).toBeTruthy();
    expect(option(big, "Once in the setup script").getAttribute("aria-disabled")).toBeNull();
    cleanup();
    act(() => useLabelStore.setState({ printerProfile: {} }));
    const fresh = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: huge } }} onChange={() => undefined} />);
    expect(option(fresh, "Once in the setup script").getAttribute("aria-disabled")).toBe("true");
  });

  it("blocks setup when the cache cannot ship and no image backs it", () => {
    const obj = stored();
    const r = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: "^GFA,4,4,1," } }} onChange={() => undefined} />);
    expect(option(r, "Once in the setup script").getAttribute("aria-disabled")).toBe("true");
  });
});
