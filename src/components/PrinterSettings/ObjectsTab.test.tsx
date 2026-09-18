// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ObjectsTab } from "./ObjectsTab";
import { useLabelStore } from "../../store/labelStore";
import type { LabelObject } from "@zplab/core/types/Group";
import type * as ImageToZpl from "@zplab/core/lib/imageToZpl";
import type * as ImageRegistry from "@zplab/core/registry/image";

const { encode, verdict } = vi.hoisted(() => ({
  encode: vi.fn(async () => ({ zpl: "^GFA,4,4,1,00FFFF00", widthDots: 8, heightDots: 4 })),
  verdict: vi.fn<() => { fit: "tooLarge" | "unshippable" } | undefined>(() => undefined),
}));
vi.mock("@zplab/core/lib/imageToZpl", async (importOriginal) => ({
  ...(await importOriginal<typeof ImageToZpl>()),
  encodeGraphicFile: () => encode(),
}));
// jsdom has no canvas, so a refusal of a fresh encode is injected in front of the real verdict.
vi.mock("@zplab/core/registry/image", async (importOriginal) => {
  const real = await importOriginal<typeof ImageRegistry>();
  return { ...real, setupGraphicOf: (p: Parameters<typeof real.setupGraphicOf>[0]) => verdict() ?? real.setupGraphicOf(p) };
});

const GFA = "^GFA,4,4,1,00FFFF00";
const logoProps = { imageId: "", widthDots: 8, heightDots: 4, threshold: 128, _gfaCache: GFA, storedAs: { device: "R", name: "LOGO" } };
const logo = { id: "img1", type: "image", x: 0, y: 0, rotation: 0, props: logoProps } as unknown as LabelObject;
const withProps = (props: object): LabelObject => ({ ...logo, props: { ...logoProps, ...props } }) as unknown as LabelObject;

beforeEach(() => {
  act(() => useLabelStore.setState({ pages: [{ objects: [logo] }], printerProfile: {} }));
});

afterEach(() => {
  cleanup();
  act(() => useLabelStore.setState({ pages: [{ objects: [] }], printerProfile: {} }));
});

describe("ObjectsTab", () => {
  it("lists a stored graphic of the design and adds it to the setup script with its bytes", () => {
    const { getByLabelText, getByTitle } = render(<ObjectsTab />);
    expect(getByTitle("R:LOGO.GRF")).toBeTruthy();
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:LOGO.GRF", gfa: GFA }]);
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });

  it("finds a profile entry spelled differently from the object's key, as the state derivation does", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "r:logo.grf", gfa: GFA }] } }));
    const { getByLabelText, queryByTitle } = render(<ObjectsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).checked).toBe(true);
    expect(queryByTitle("r:logo.grf")).toBeNull();
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });

  it("keeps a stale entry checked, names it, and re-sends the current bytes on request", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: "^GFA,4,4,1,FF0000FF" }] } }));
    const { getByLabelText, getByText } = render(<ObjectsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).checked).toBe(true);
    act(() => {
      fireEvent.click(getByText(/Send again/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:LOGO.GRF", gfa: GFA }]);
  });

  it("cannot vouch for an entry once the object's cache is gone, and offers no dead action without image data", () => {
    act(() => useLabelStore.setState({
      pages: [{ objects: [withProps({ _gfaCache: undefined })] }],
      printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] },
    }));
    const { getByLabelText, getByText, queryByRole } = render(<ObjectsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).checked).toBe(true);
    expect(getByText(/not verifiable/)).toBeTruthy();
    expect(queryByRole("button", { name: /not verifiable/ })).toBeNull();
  });

  it("warns about a recall-only object no setup entry backs", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [withProps({ storedAs: { device: "R", name: "LOGO", embedInZpl: false } })] }] }));
    const { getByText } = render(<ObjectsTab />);
    expect(getByText(/uploaded by nothing/)).toBeTruthy();
  });

  it("refuses bytes past the profile cap and hides a recall of a file no upload writes", () => {
    const huge = `^GFA,600000,600000,1,${"F".repeat(1_200_000)}`;
    act(() => useLabelStore.setState({ pages: [{ objects: [
      withProps({ _gfaCache: huge }),
      { ...withProps({ storedAs: { device: "R", name: "PIC", ext: "PNG", recall: "IM", embedInZpl: false } }), id: "img2" } as LabelObject,
    ] }] }));
    const { getByLabelText, getByText, queryByTitle } = render(<ObjectsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).disabled).toBe(true);
    expect(getByText(/Too large/)).toBeTruthy();
    expect(queryByTitle("R:PIC.GRF")).toBeNull();
  });

  it("names an entry whose new bytes exceed the cap as too large, offers no re-send, and still lets it go", () => {
    const huge = `^GFA,600000,600000,1,${"F".repeat(1_200_000)}`;
    act(() => useLabelStore.setState({
      pages: [{ objects: [withProps({ _gfaCache: huge })] }],
      printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] },
    }));
    const { getByLabelText, getByText, queryByRole } = render(<ObjectsTab />);
    expect(getByText(/Too large/)).toBeTruthy();
    expect(queryByRole("button", { name: /Send again|not verifiable/ })).toBeNull();
    const box = getByLabelText(/Send at setup/) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    act(() => {
      fireEvent.click(box);
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });

  it("names a refused send on its row instead of letting the click go silent", () => {
    const { getByLabelText, getByText, queryByText } = render(<ObjectsTab />);
    verdict.mockReturnValueOnce({ fit: "unshippable" });
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(getByText(/Too wide/)).toBeTruthy();
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
    act(() => useLabelStore.setState({ pages: [{ objects: [withProps({ _gfaCache: "^GFA,4,4,1,FFFFFFFF" })] }] }));
    expect(queryByText(/Too wide/)).toBeNull();
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:LOGO.GRF", gfa: "^GFA,4,4,1,FFFFFFFF" }]);
  });

  const pick = async (input: HTMLInputElement, name: string) => {
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "image/png" })] } });
    });
  };

  it("uploads a graphic file straight into the profile under its file name", async () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const { getByLabelText } = render(<ObjectsTab />);
    await pick(getByLabelText(/Upload graphic/) as HTMLInputElement, "my logo.png");
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:MYLOGO.GRF", gfa: GFA }]);
  });

  it("refuses an upload the profile or the emitter would not take, and names why", async () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const { getByLabelText, getByText } = render(<ObjectsTab />);
    const input = getByLabelText(/Upload graphic/) as HTMLInputElement;
    encode.mockResolvedValueOnce({ zpl: `^GFA,600000,600000,1,${"F".repeat(1_200_000)}`, widthDots: 8, heightDots: 600000 });
    await pick(input, "big.png");
    expect(getByText(/Too large/)).toBeTruthy();
    encode.mockResolvedValueOnce({ zpl: `^GFA,2000,2000,2000,${"F".repeat(4000)}`, widthDots: 16000, heightDots: 1 });
    await pick(input, "wide.png");
    expect(getByText(/Too wide/)).toBeTruthy();
    await pick(input, ".png");
    expect(getByText(/no usable object name/)).toBeTruthy();
    encode.mockRejectedValueOnce(new Error("boom"));
    await pick(input, "broken.png");
    expect(getByText(/Could not load the graphic/)).toBeTruthy();
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });

  it("keeps an earlier upload when a second one resolves later", async () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const { getByLabelText } = render(<ObjectsTab />);
    const input = getByLabelText(/Upload graphic/) as HTMLInputElement;
    await pick(input, "aaa.png");
    await pick(input, "bbb.png");
    expect(useLabelStore.getState().printerProfile.setupGraphics?.map((g) => g.path)).toEqual(["R:AAA.GRF", "R:BBB.GRF"]);
  });

  it("disables the checkbox of a recall-only object nothing can encode", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [withProps({ _gfaCache: undefined, storedAs: { device: "R", name: "LOGO", embedInZpl: false } })] }] }));
    const { getByLabelText } = render(<ObjectsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a profile entry no design object names and removes it on request", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:OLD.GRF", gfa: GFA }] } }));
    const { getByTitle, getByLabelText } = render(<ObjectsTab />);
    expect(getByTitle("R:OLD.GRF")).toBeTruthy();
    act(() => {
      fireEvent.click(getByLabelText(/Remove from setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });
});
