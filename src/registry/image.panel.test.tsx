// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { putImage, removeImage } from "@zplab/core/lib/imageCache";

// jsdom loads no image, so a real encode would sit out the 15 s decode timeout.
vi.mock("@zplab/core/lib/imageToZpl", () => ({ imageToGFA: vi.fn(async () => ({ zpl: "^GFA,4,4,1,00FFFF00" })) }));
import { imagePanel } from "./image.panel";
import { useLabelStore } from "../store/labelStore";
import type { ImageProps } from "@zplab/core/registry/image";
import type { LabelObjectBase } from "@zplab/core/types/LabelObject";
import type * as ImageRegistry from "@zplab/core/registry/image";
import { ObjectRegistry } from "@zplab/core/registry";

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
  removeImage("cat");
  act(() => useLabelStore.setState({ printerProfile: {} }));
});

const option = (r: ReturnType<typeof render>, name: string) => {
  act(() => {
    fireEvent.click(r.getByRole("button", { name: /^Delivery/ }));
  });
  return r.getByRole("option", { name }) as HTMLElement;
};

const inline = (): LabelObjectBase & { props: ImageProps } => {
  const { storedAs: _storedAs, ...props } = stored().props;
  return { ...stored(), props };
};

describe("image source", () => {
  it("places a graphic the profile holds as a recall with the profile's bytes and size", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const onChange = vi.fn();
    const r = render(<Panel obj={inline()} onChange={onChange} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: /^Image source/ }));
    });
    act(() => {
      r.getByRole("option", { name: "R:LOGO.GRF" }).click();
    });
    expect(onChange).toHaveBeenCalledWith({ imageId: "", storedAs: { device: "R", name: "LOGO", embedInZpl: false }, _gfaCache: GFA, rawGf: undefined, widthDots: 8, heightDots: 4 });
  });

  it("retires opaque bytes when a profile graphic is picked, so the recall is what prints", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const onChange = vi.fn();
    const obj = inline();
    const opaque = { ...obj, props: { ...obj.props, _gfaCache: undefined, rawGf: "^GFA,4,4,1,FFFFFFFF" } };
    const r = render(<Panel obj={opaque} onChange={onChange} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: /^Image source/ }));
    });
    act(() => {
      r.getByRole("option", { name: "R:LOGO.GRF" }).click();
    });
    const patch = onChange.mock.calls[0]?.[0] as Partial<ImageProps>;
    const picked = { ...opaque, props: { ...opaque.props, ...patch } };
    const zpl = ObjectRegistry.image!.toZPL?.(picked as never, {} as never) ?? "";
    expect(zpl).toContain("^XGR:LOGO.GRF");
    expect(zpl).not.toContain("FFFFFFFF");
  });

  it("shows no profile entry chosen for a recall spelled .PNG", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const png = stored({ ext: "PNG", recall: "IM", embedInZpl: false });
    const r = render(<Panel obj={png} onChange={vi.fn()} />);
    expect(r.getByRole("button", { name: /^Image source/ }).textContent).toMatch(/Select image/);
  });

  it("retires a recall-only name when a browser image is picked, so the picked bytes print", async () => {
    putImage({ id: "cat", name: "cat.png", dataUrl: "data:image/png;base64,", width: 1, height: 1 });
    const onChange = vi.fn();
    const r = render(<Panel obj={stored({ embedInZpl: false })} onChange={onChange} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: /^Image source/ }));
    });
    act(() => {
      r.getByRole("option", { name: "cat.png" }).click();
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const patch = onChange.mock.calls[0]?.[0] as Partial<ImageProps>;
    expect(patch).toMatchObject({ imageId: "cat", rawGf: undefined, storedAs: undefined });
    expect("storedAs" in patch).toBe(true);
  });

  it("shows the profile's own spelling of a recalled path", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "r:logo.grf", gfa: GFA }] } }));
    const r = render(<Panel obj={stored({ embedInZpl: false })} onChange={vi.fn()} />);
    expect(r.getByRole("button", { name: /^Image source/ }).textContent).toContain("r:logo.grf");
  });

  it("offers the profile entry to a graphic that still ships its own bytes", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const onChange = vi.fn();
    const r = render(<Panel obj={stored()} onChange={onChange} />);
    expect(r.getByRole("button", { name: /^Image source/ }).textContent).toMatch(/Select image/);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: /^Image source/ }));
    });
    act(() => {
      r.getByRole("option", { name: "R:LOGO.GRF" }).click();
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ storedAs: { device: "R", name: "LOGO", embedInZpl: false } }));
  });

  it("refreshes a recall whose bytes the profile has replaced on a re-pick", () => {
    const fresh = "^GFA,4,4,1,FFFFFFFF";
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: fresh }] } }));
    const onChange = vi.fn();
    const r = render(<Panel obj={stored({ embedInZpl: false })} onChange={onChange} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: /^Image source/ }));
    });
    act(() => {
      r.getByRole("option", { name: "R:LOGO.GRF" }).click();
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ _gfaCache: fresh }));
  });

  it("writes nothing on a re-pick of the current source", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const onChange = vi.fn();
    const r = render(<Panel obj={stored({ embedInZpl: false })} onChange={onChange} />);
    act(() => {
      fireEvent.click(r.getByRole("button", { name: /^Image source/ }));
    });
    act(() => {
      r.getByRole("option", { name: "R:LOGO.GRF" }).click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the recalled path as the chosen source", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: GFA }] } }));
    const r = render(<Panel obj={stored({ embedInZpl: false })} onChange={vi.fn()} />);
    expect(r.getByRole("button", { name: /^Image source/ }).textContent).toContain("R:LOGO.GRF");
  });
});

describe("image panel delivery", () => {
  it("names an inline graphic on the printer when a way off the job is chosen", () => {
    const onChange = vi.fn();
    const r = render(<Panel obj={inline()} onChange={onChange} />);
    expect(r.getByRole("button", { name: /^Delivery/ }).textContent).toContain("With every job");
    expect(r.queryByRole("button", { name: /Embed inline/ })).toBeNull();
    choose(r, "Already on the printer");
    expect(onChange).toHaveBeenCalledWith({ storedAs: { device: "R", name: expect.stringMatching(/^IMG_[0-9A-F]{4}$/), embedInZpl: false } });
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });

  it("keeps opaque bytes off the printer and the setup script", () => {
    const obj = inline();
    const r = render(<Panel obj={{ ...obj, props: { ...obj.props, _gfaCache: undefined, rawGf: GFA } }} onChange={vi.fn()} />);
    expect(option(r, "Already on the printer").getAttribute("aria-disabled")).toBe("true");
    expect(r.getByRole("option", { name: "Once in the setup script" }).getAttribute("aria-disabled")).toBe("true");
    expect(r.getByRole("option", { name: "With every job" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("copies an inline graphic into the profile under its drafted name when setup is chosen", () => {
    const onChange = vi.fn();
    const r = render(<Panel obj={inline()} onChange={onChange} />);
    choose(r, "Once in the setup script");
    const entries = useLabelStore.getState().printerProfile.setupGraphics ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: expect.stringMatching(/^R:IMG_[0-9A-F]{4}\.GRF$/), gfa: GFA });
    expect(onChange).toHaveBeenCalledWith({ storedAs: { device: "R", name: entries[0]?.path.slice(2, -4), embedInZpl: false }, _gfaCache: GFA });
  });

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

  it("keeps the select shut for a locked object, so no orphan upload lands in the profile", () => {
    const onChange = vi.fn();
    const r = render(<Panel obj={inline()} onChange={onChange} locked />);
    const trigger = r.getByRole("button", { name: /^Delivery/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    act(() => {
      fireEvent.click(trigger);
    });
    expect(r.queryByRole("option", { name: "Once in the setup script" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(useLabelStore.getState().printerProfile.setupGraphics).toBeUndefined();
  });

  it("drafts a fresh name once the profile took the last one", () => {
    const onChange = vi.fn();
    const r = render(<Panel obj={inline()} onChange={onChange} />);
    choose(r, "Once in the setup script");
    const first = (onChange.mock.calls[0]?.[0] as ImageProps).storedAs?.name;
    expect(useLabelStore.getState().printerProfile.setupGraphics?.[0]?.path).toBe(`R:${first}.GRF`);
    r.rerender(<Panel obj={inline()} onChange={onChange} />);
    choose(r, "Already on the printer");
    const second = (onChange.mock.calls[1]?.[0] as ImageProps).storedAs?.name;
    expect(second).toMatch(/^IMG_[0-9A-F]{4}$/);
    expect(second).not.toBe(first);
  });

  it("blocks the job for a rotated inline graphic", () => {
    const obj = inline();
    const r = render(<Panel obj={{ ...obj, props: { ...obj.props, rotation: "R" } }} onChange={() => undefined} />);
    expect(r.getByText(/Needs image data to send/)).toBeTruthy();
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
