// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printLabel, printReplaced } from "./printSheet";

const decodes = () => Object.defineProperty(HTMLImageElement.prototype, "decode", { value: () => Promise.resolve(), configurable: true });

describe("printLabel", () => {
  let revoked: string[];
  let imgs: HTMLImageElement[];
  let sheetSrc: string | null;
  let sheetsAtPrint = 0;
  let print: ReturnType<typeof vi.fn>;
  const armed = () => document.documentElement.classList.contains("printing-label");
  const sheets = () => document.querySelectorAll(".print-sheet").length;
  /** The module's own image never enters the document before it is ready, so the test holds it instead. */
  const held = (nth = imgs.length - 1): HTMLImageElement => {
    const img = imgs[nth];
    if (!img) throw new Error(`no image number ${nth} was built`);
    return img;
  };
  const seen = () => {
    sheetSrc = document.querySelector<HTMLImageElement>(".print-sheet img")?.src ?? null;
    sheetsAtPrint = sheets();
  };
  /** A normal browser print. */
  const announcing = () => {
    seen();
    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("afterprint"));
  };
  /** The same, with a dialog the user has not answered yet. */
  const slow = () => {
    seen();
    window.dispatchEvent(new Event("beforeprint"));
  };
  /** The macOS shell path. */
  const shell = () => {
    seen();
    return Promise.resolve();
  };

  beforeEach(() => {
    revoked = [];
    imgs = [];
    sheetSrc = null;
    sheetsAtPrint = 0;
    vi.useFakeTimers();
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revoked.push(url));
    // jsdom loads no images and offers no decode, so the browser's is stood in for.
    decodes();
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = create(tag);
      if (tag === "img") imgs.push(el as HTMLImageElement);
      return el;
    });
    print = vi.fn(announcing);
    vi.stubGlobal("print", print);
  });

  afterEach(async () => {
    // The shell path holds its sheet until the next print, so one more print clears the module out.
    decodes();
    print.mockImplementation(announcing);
    await printLabel("blob:reset");
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    document.documentElement.classList.remove("printing-label");
  });

  it("prints the label through this document and gives the bytes back", async () => {
    await printLabel("blob:label");

    expect(print).toHaveBeenCalledOnce();
    expect(sheetSrc).toBe("blob:label");
    expect(armed()).toBe(false);
    expect(sheets()).toBe(0);
    expect(revoked).toEqual(["blob:label"]);
  });

  it("leaves nothing listening once the job is through", async () => {
    await printLabel("blob:over");

    // A print the user starts themselves must show the app, not the label from before.
    window.dispatchEvent(new Event("beforeprint"));
    expect(armed()).toBe(false);
    expect(sheets()).toBe(0);
  });

  it("keeps the sheet standing for as long as a dialog takes", async () => {
    print.mockImplementation(slow);
    await printLabel("blob:slow");

    await vi.advanceTimersByTimeAsync(900_000);
    // No deadline may cut a print short: the sheet is what the engine paints when the user confirms.
    expect(armed()).toBe(true);
    expect(sheets()).toBe(1);
    expect(revoked).toEqual([]);
    window.dispatchEvent(new Event("afterprint"));
    expect(sheets()).toBe(0);
  });

  it("answers the caller as soon as the engine takes the call", async () => {
    // An engine that opens a dialog and reports nothing until the user has answered it.
    print.mockImplementation(() => {
      seen();
    });

    await printLabel("blob:quiet");

    await vi.advanceTimersByTimeAsync(900_000);
    // No deadline may take the sheet away while a dialog of that engine is still open.
    expect(armed()).toBe(true);
    expect(sheets()).toBe(1);
    expect(revoked).toEqual([]);
  });

  it("hands a refused print to the caller instead of reporting success", async () => {
    print.mockImplementation(() => {
      throw new Error("printing is blocked");
    });

    await expect(printLabel("blob:blocked")).rejects.toThrow("printing is blocked");
    expect(armed()).toBe(false);
    expect(sheets()).toBe(0);
    expect(revoked).toEqual(["blob:blocked"]);
  });

  it("still prints where the print media query has no event target", async () => {
    // Safari 13 is such a build, and a second source may not cost the first one.
    vi.stubGlobal("matchMedia", () => {
      throw new TypeError("addEventListener is not a function");
    });

    await printLabel("blob:old-safari");

    expect(sheetSrc).toBe("blob:old-safari");
    expect(sheets()).toBe(0);
    expect(revoked).toEqual(["blob:old-safari"]);
  });

  it("takes both edges of the print media query as word about the job", async () => {
    let fire: (e: { matches: boolean }) => void = () => undefined;
    const media = {
      matches: false,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        fire = cb;
      },
      removeEventListener: () => undefined,
    };
    vi.stubGlobal("matchMedia", () => media);
    // An engine that reports no print event, which WebKit builds are repeatedly suspected of.
    print.mockImplementation(() => {
      seen();
      fire({ matches: true });
    });

    await printLabel("blob:media");

    await vi.advanceTimersByTimeAsync(2_000);
    // The deadline would otherwise have pulled the sheet out from under an open print dialog.
    expect(sheetSrc).toBe("blob:media");
    expect(armed()).toBe(true);
    expect(sheets()).toBe(1);

    fire({ matches: false });
    // And the sheet may not outlive the job, or the next print of the user's own shows this label.
    expect(armed()).toBe(false);
    expect(sheets()).toBe(0);
    expect(revoked).toEqual(["blob:media"]);
  });

  it("replaces the previous label instead of stacking a second one onto the page", async () => {
    await printLabel("blob:first");
    await printLabel("blob:second");

    expect(sheetSrc).toBe("blob:second");
    expect(sheetsAtPrint).toBe(1);
    expect(revoked).toEqual(["blob:first", "blob:second"]);
  });

  describe("when the shell prints for us", () => {
    it("takes the promise as the answer and keeps the sheet for the dialog", async () => {
      print.mockImplementation(shell);
      await printLabel("blob:shell");

      // No print event ever arrives on this path, and the shell paints the document when the user
      // confirms, so taking the sheet away on a deadline would print the app instead of the label.
      expect(sheetSrc).toBe("blob:shell");
      expect(armed()).toBe(true);
      expect(sheets()).toBe(1);
      await vi.advanceTimersByTimeAsync(900_000);
      expect(sheets()).toBe(1);
      expect(revoked).toEqual([]);
    });

    it("hands a late refusal to its own caller and leaves the sheet that replaced it", async () => {
      let refuse: (e: Error) => void = () => undefined;
      print.mockImplementation(() => new Promise((_, reject) => (refuse = reject)));
      const first = expect(printLabel("blob:a")).rejects.toThrow("not allowed");
      await vi.advanceTimersByTimeAsync(0);

      print.mockImplementation(shell);
      await printLabel("blob:b");
      refuse(new Error("webview.print not allowed"));
      await first;

      // The late refusal belongs to a print that is already gone and may not touch the one standing.
      expect(sheets()).toBe(1);
      expect(armed()).toBe(true);
      expect(revoked).toEqual(["blob:a"]);
    });

    it("hands the shell's own refusal to the caller", async () => {
      // A missing webview print permission is how Tauri rejects this call on macOS.
      print.mockImplementation(() => Promise.reject(new Error("webview.print not allowed")));

      await expect(printLabel("blob:denied")).rejects.toThrow("not allowed");
      expect(armed()).toBe(false);
      expect(sheets()).toBe(0);
      expect(revoked).toEqual(["blob:denied"]);
    });
  });

  describe("while the bytes are still coming", () => {
    beforeEach(() => {
      // No decode, so the load event is the only gate and the test holds it open.
      delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
    });

    it("has nothing in the document and nothing armed", async () => {
      const printing = printLabel("blob:pending");
      await vi.advanceTimersByTimeAsync(0);

      // The user's own Ctrl+P must print the app, not a label that is not even ready.
      expect(armed()).toBe(false);
      expect(sheets()).toBe(0);
      expect(print).not.toHaveBeenCalled();

      held().dispatchEvent(new Event("load"));
      await printing;
      expect(sheetSrc).toBe("blob:pending");
    });

    it("gives the later click the sheet, whatever order the renders come back in", async () => {
      const first = expect(printLabel("blob:one")).rejects.toBe(printReplaced);
      await vi.advanceTimersByTimeAsync(0);
      const second = printLabel("blob:two");
      await vi.advanceTimersByTimeAsync(0);
      expect(sheets()).toBe(0);

      // The older render answers first here, and must not take the job from the newer click.
      held(0).dispatchEvent(new Event("load"));
      await first;
      expect(print).not.toHaveBeenCalled();
      expect(revoked).toEqual(["blob:one"]);

      held(1).dispatchEvent(new Event("load"));
      await second;
      expect(sheetSrc).toBe("blob:two");
      expect(sheetsAtPrint).toBe(1);
    });

    it("gives the bytes back and leaves no sheet when the image fails", async () => {
      const printing = printLabel("blob:broken");
      await vi.advanceTimersByTimeAsync(0);
      held().dispatchEvent(new Event("error"));

      await expect(printing).rejects.toThrow("could not be loaded");
      expect(print).not.toHaveBeenCalled();
      expect(armed()).toBe(false);
      expect(sheets()).toBe(0);
      expect(revoked).toEqual(["blob:broken"]);
    });
  });
});
