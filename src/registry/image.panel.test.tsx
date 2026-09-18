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

beforeEach(() => {
  useLabelStore.temporal.getState().clear();
  act(() => useLabelStore.setState({ printerProfile: {} }));
});
afterEach(() => {
  cleanup();
  act(() => useLabelStore.setState({ printerProfile: {} }));
});

describe("image panel setup-script handoff", () => {
  it("copies the bytes into the profile and leaves the label recall-only", () => {
    const onChange = vi.fn();
    const { getByText } = render(<Panel obj={stored()} onChange={onChange} />);
    act(() => {
      fireEvent.click(getByText(/Upload at setup instead/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:LOGO.GRF", gfa: GFA }]);
    expect(onChange).toHaveBeenCalledWith({ storedAs: { device: "R", name: "LOGO", embedInZpl: false }, _gfaCache: GFA });
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
    const { getByText, queryByText, rerender } = render(<Panel obj={obj} onChange={() => undefined} />);
    verdict.mockReturnValueOnce({ fit: "unshippable" });
    act(() => {
      fireEvent.click(getByText(/Upload at setup instead/));
    });
    expect(getByText(/Too wide/)).toBeTruthy();
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
    rerender(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: "^GFA,4,4,1,FFFFFFFF" } }} onChange={() => undefined} />);
    expect(queryByText(/Too wide/)).toBeNull();
    expect(getByText(/Upload at setup instead/)).toBeTruthy();
  });

  it("neither vouches for the entry nor offers a dead button once the cache is gone without image data", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const obj = stored({ embedInZpl: false });
    const { queryByText } = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: undefined } }} onChange={() => undefined} />);
    expect(queryByText(/Uploaded once by the setup script/)).toBeNull();
    expect(queryByText(/Upload at setup instead/)).toBeNull();
  });

  it("names bytes past the cap as too large instead of offering a re-send that cannot run", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const obj = stored({ embedInZpl: false });
    const huge = `^GFA,600000,600000,1,${"F".repeat(1_200_000)}`;
    const { getByText, queryByText } = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: huge } }} onChange={() => undefined} />);
    expect(getByText(/Too large/)).toBeTruthy();
    expect(queryByText(/Upload at setup instead/)).toBeNull();
    expect(queryByText(/Uploaded once by the setup script/)).toBeNull();
  });

  it("hides the button when the cache cannot ship and no image backs it", () => {
    const obj = stored();
    const { queryByText } = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: "^GFA,4,4,1," } }} onChange={() => undefined} />);
    expect(queryByText(/Upload at setup instead/)).toBeNull();
  });

  it("names an entry the setup script already carries instead of offering the button", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const { getByText, queryByText } = render(<Panel obj={stored({ embedInZpl: false })} onChange={() => undefined} />);
    expect(getByText(/Uploaded once by the setup script/)).toBeTruthy();
    expect(queryByText(/Upload at setup instead/)).toBeNull();
  });
});
