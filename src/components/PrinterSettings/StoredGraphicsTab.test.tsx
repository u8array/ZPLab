// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act, within } from "@testing-library/react";
import { StoredGraphicsTab } from "./StoredGraphicsTab";
import { useLabelStore } from "../../store/labelStore";
import type { LabelObject } from "@zplab/core/types/Group";
import { getAllImages, putImage, removeImage } from "@zplab/core/lib/imageCache";
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
  useLabelStore.temporal.getState().clear();
  act(() => useLabelStore.setState({ pages: [{ objects: [logo] }], printerProfile: {}, sourceEdit: { status: "off" } }));
});

afterEach(() => {
  cleanup();
  for (const id of ["used", "spare", "a", "b", "gone", "clip"]) removeImage(id);
  act(() => useLabelStore.setState({ pages: [{ objects: [] }], printerProfile: {} }));
});

describe("StoredGraphicsTab", () => {
  it("lists a stored graphic of the design and adds it to the setup script with its bytes", () => {
    const { getByLabelText, getByTitle } = render(<StoredGraphicsTab />);
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
    const { getByLabelText, queryByTitle } = render(<StoredGraphicsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).checked).toBe(true);
    expect(queryByTitle("r:logo.grf")).toBeNull();
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });

  it("keeps a stale entry checked, names it, and re-sends the current bytes on request", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: "^GFA,4,4,1,FF0000FF" }] } }));
    const { getByLabelText, getByText } = render(<StoredGraphicsTab />);
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
    const { getByLabelText, getByText, queryByRole } = render(<StoredGraphicsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).checked).toBe(true);
    expect(getByText(/not verifiable/)).toBeTruthy();
    expect(queryByRole("button", { name: /not verifiable/ })).toBeNull();
  });

  it("warns about a recall-only object no setup entry backs", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [withProps({ storedAs: { device: "R", name: "LOGO", embedInZpl: false } })] }] }));
    const { getByText } = render(<StoredGraphicsTab />);
    expect(getByText(/uploaded by nothing/)).toBeTruthy();
  });

  it("refuses bytes past the profile cap and hides a recall of a file no upload writes", () => {
    const huge = `^GFA,600000,600000,1,${"F".repeat(1_200_000)}`;
    act(() => useLabelStore.setState({ pages: [{ objects: [
      withProps({ _gfaCache: huge }),
      { ...withProps({ storedAs: { device: "R", name: "PIC", ext: "PNG", recall: "IM", embedInZpl: false } }), id: "img2" } as LabelObject,
    ] }] }));
    const { getByLabelText, getByText, queryByTitle } = render(<StoredGraphicsTab />);
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
    const { getByLabelText, getByText, queryByRole } = render(<StoredGraphicsTab />);
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
    const { getByLabelText, getByText, queryByText } = render(<StoredGraphicsTab />);
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

  it("lists the local image cache with its usage and deletes only what nothing references", () => {
    putImage({ id: "used", name: "used.png", dataUrl: "data:,", width: 8, height: 4 });
    putImage({ id: "spare", name: "spare.png", dataUrl: "data:,", width: 8, height: 4 });
    act(() => useLabelStore.setState({ pages: [{ objects: [withProps({ imageId: "used" })] }] }));
    const { getAllByLabelText, getByText, getByRole } = render(<StoredGraphicsTab />);
    expect(getByText(/Objects using it: 1/)).toBeTruthy();
    expect(getByText(/Not used by the open design/)).toBeTruthy();
    const [first, second] = getAllByLabelText(/Delete local copy/) as HTMLButtonElement[];
    expect(first!.disabled).toBe(true);
    act(() => {
      fireEvent.click(second!);
    });
    expect(getAllImages().map((i) => i.id)).toEqual(["used", "spare"]);
    act(() => {
      fireEvent.click(within(getByRole("alertdialog")).getByText("Delete local copy"));
    });
    expect(getAllImages().map((i) => i.id)).toEqual(["used"]);
  });

  it("removes every unused cached image at once", () => {
    putImage({ id: "a", name: "a.png", dataUrl: "data:,", width: 8, height: 4 });
    putImage({ id: "b", name: "b.png", dataUrl: "data:,", width: 8, height: 4 });
    act(() => useLabelStore.setState({ pages: [{ objects: [withProps({ imageId: "a" })] }] }));
    const { getByText, getByRole } = render(<StoredGraphicsTab />);
    act(() => {
      fireEvent.click(getByText(/Remove unused/));
    });
    act(() => {
      fireEvent.click(within(getByRole("alertdialog")).getByText("Delete local copy"));
    });
    expect(getAllImages().map((i) => i.id)).toEqual(["a"]);
    expect((getByText(/Remove unused/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a row an undo step still names out of the cleanup, and frees it once the history is gone", () => {
    putImage({ id: "gone", name: "gone.png", dataUrl: "data:,", width: 8, height: 4 });
    act(() => useLabelStore.setState({ pages: [{ objects: [withProps({ imageId: "gone" })] }] }));
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const first = render(<StoredGraphicsTab />);
    expect(first.getByText(/Not used by the open design/)).toBeTruthy();
    expect((first.getByLabelText(/Delete local copy/) as HTMLButtonElement).disabled).toBe(true);
    expect((first.getByText(/Remove unused/) as HTMLButtonElement).disabled).toBe(true);
    first.unmount();
    act(() => useLabelStore.temporal.getState().clear());
    const second = render(<StoredGraphicsTab />);
    expect((second.getByLabelText(/Delete local copy/) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a row only the clipboard names out of the cleanup", () => {
    putImage({ id: "clip", name: "clip.png", dataUrl: "data:,", width: 8, height: 4 });
    act(() => useLabelStore.setState({ pages: [{ objects: [] }], clipboard: [withProps({ imageId: "clip" })] }));
    const { getByLabelText, getByText } = render(<StoredGraphicsTab />);
    expect((getByLabelText(/Delete local copy/) as HTMLButtonElement).disabled).toBe(true);
    expect((getByText(/Remove unused/) as HTMLButtonElement).disabled).toBe(true);
    act(() => useLabelStore.setState({ clipboard: [] }));
  });

  it("refuses a second file whose folded name holds other bytes in the profile", async () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const { getByLabelText, getByText } = render(<StoredGraphicsTab />);
    const input = getByLabelText(/Upload graphic/) as HTMLInputElement;
    await pick(input, "COMPANYLOGO1.png");
    encode.mockResolvedValueOnce({ zpl: "^GFA,4,4,1,FFFFFFFF", widthDots: 8, heightDots: 4 });
    await pick(input, "COMPANYLOGO2.png");
    expect(getByText(/Rename the file/)).toBeTruthy();
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:COMPANYL.GRF", gfa: GFA }]);
    await pick(input, "COMPANYLOGO1.png");
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:COMPANYL.GRF", gfa: GFA }]);
  });

  it("names a profile patch the editor refused after the file was picked", async () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const release: ((r: { zpl: string; widthDots: number; heightDots: number }) => void)[] = [];
    encode.mockImplementationOnce(() => new Promise((resolve) => release.push(resolve)));
    const { getByLabelText, getByText } = render(<StoredGraphicsTab />);
    act(() => {
      fireEvent.change(getByLabelText(/Upload graphic/), { target: { files: [new File(["x"], "late.png", { type: "image/png" })] } });
    });
    act(() => useLabelStore.setState({ sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 5 } }));
    await act(async () => {
      release[0]!({ zpl: GFA, widthDots: 8, heightDots: 4 });
    });
    expect(getByText(/Not available while the editor is locked/)).toBeTruthy();
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
    act(() => useLabelStore.setState({ sourceEdit: { status: "off" } }));
  });

  it("locks the cache cleanup while a source session owns the model", () => {
    putImage({ id: "a", name: "a.png", dataUrl: "data:,", width: 8, height: 4 });
    act(() =>
      useLabelStore.setState({
        pages: [{ objects: [] }],
        sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 99 },
      }),
    );
    const { getByText, getAllByLabelText } = render(<StoredGraphicsTab />);
    expect((getByText(/Remove unused/) as HTMLButtonElement).disabled).toBe(true);
    expect((getAllByLabelText(/Delete local copy/)[0] as HTMLButtonElement).disabled).toBe(true);
  });

  const pick = async (input: HTMLInputElement, name: string) => {
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "image/png" })] } });
    });
  };

  it("uploads a graphic file straight into the profile under its file name", async () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const { getByLabelText } = render(<StoredGraphicsTab />);
    await pick(getByLabelText(/Upload graphic/) as HTMLInputElement, "my logo.png");
    expect(useLabelStore.getState().printerProfile.setupGraphics).toEqual([{ path: "R:MYLOGO.GRF", gfa: GFA }]);
  });

  it("refuses an upload the profile or the emitter would not take, and names why", async () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const { getByLabelText, getByText } = render(<StoredGraphicsTab />);
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

  it("keeps both uploads when two are in flight from the same render", async () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const release: ((r: { zpl: string; widthDots: number; heightDots: number }) => void)[] = [];
    encode.mockImplementation(() => new Promise((resolve) => release.push(resolve)));
    const { getByLabelText } = render(<StoredGraphicsTab />);
    const input = getByLabelText(/Upload graphic/) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { files: [new File(["x"], "aaa.png", { type: "image/png" })] } });
      fireEvent.change(input, { target: { files: [new File(["x"], "bbb.png", { type: "image/png" })] } });
    });
    await act(async () => {
      for (const resolve of release) resolve({ zpl: GFA, widthDots: 8, heightDots: 4 });
    });
    encode.mockImplementation(async () => ({ zpl: GFA, widthDots: 8, heightDots: 4 }));
    expect(useLabelStore.getState().printerProfile.setupGraphics?.map((g) => g.path)).toEqual(["R:AAA.GRF", "R:BBB.GRF"]);
  });

  it("disables the checkbox of a recall-only object nothing can encode", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [withProps({ _gfaCache: undefined, storedAs: { device: "R", name: "LOGO", embedInZpl: false } })] }] }));
    const { getByLabelText } = render(<StoredGraphicsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a profile entry no design object names and removes it on request", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:OLD.GRF", gfa: GFA }] } }));
    const { getByTitle, getByLabelText } = render(<StoredGraphicsTab />);
    expect(getByTitle("R:OLD.GRF")).toBeTruthy();
    act(() => {
      fireEvent.click(getByLabelText(/Remove from setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });
});
