/** The sheet the print shows. One at a time, so the class needs no instance of its own. */
const SHEET_CLASS = "print-sheet";
/** Without this flag on the root the user's own Ctrl+P would hide the app and print a blank page. */
const PRINTING_CLASS = "printing-label";

/** Shown when no print starts. No reason the engine gives leaves the caller anything to add. */
export const printErrorMessage = "Could not start the print.";

/** Not a failure to report: a newer print took this sheet over, which is what the user asked for. */
export const printReplaced = new Error("the print was replaced");

let standing: Standing | undefined;

/** Counts the clicks, so the newest print wins even when an older render answers after it. */
let issued = 0;

interface Standing {
  sheet: HTMLDivElement;
  url: string;
  stop: () => void;
  settle: (failure?: unknown) => void;
}

/** Prints through this document because a Tauri webview opens no second window. */
export async function printLabel(url: string): Promise<void> {
  const ticket = ++issued;
  const img = document.createElement("img");
  img.alt = "";
  img.src = url;
  try {
    // Waiting happens before anything is installed, so a failure here leaves no trace to undo.
    await imageReady(img);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  if (ticket !== issued) {
    URL.revokeObjectURL(url);
    throw printReplaced;
  }
  return printNow(img, url);
}

/** No await before the print, so a second print can never find a half-installed first one. */
function printNow(img: HTMLImageElement, url: string): Promise<void> {
  const sheet = document.createElement("div");
  sheet.className = SHEET_CLASS;
  sheet.append(img);
  retire(standing?.sheet);
  const { promise, settle } = deferred();
  // Tracked before it can be seen, or a throw below would orphan the sheet for the session.
  standing = { sheet, url, settle, stop: () => undefined };
  document.body.append(sheet);
  arm(true);
  try {
    // The watch stands before the print, because Chromium reports the job while the call blocks.
    const stop = watchEpisode(sheet);
    standing.stop = stop;
    const answer: unknown = window.print();
    // This path reports no print event.
    if (thenable(answer)) {
      // The local one, because a print that reported itself during the call is already retired.
      stop();
      if (standing?.sheet === sheet) standing.stop = () => undefined;
      answer.then(() => settle(), refused(sheet, settle));
    } else {
      // Waiting for a print event would cut off every engine that reports only after the dialog.
      settle();
    }
  } catch (e) {
    settle(e);
    retire(sheet);
  }
  return promise;
}

/** Only a refusal clears the sheet, because it is the one answer that printed nothing. */
const refused = (sheet: HTMLDivElement, settle: (failure?: unknown) => void) => (e: unknown) => {
  settle(e);
  retire(sheet);
};

/** The job's own brackets: the sheet goes when the episode ends. An engine that never reports an end
 *  leaves it to the next print, and in the shell no other print can reach the webview. */
function watchEpisode(sheet: HTMLDivElement): () => void {
  const onAfter = () => retire(sheet);
  // The media query brackets the episode too, and some builds answer only there.
  const stopMedia = watchMedia((e) => {
    if (!e.matches) retire(sheet);
  });
  window.addEventListener("afterprint", onAfter);
  return () => {
    stopMedia();
    window.removeEventListener("afterprint", onAfter);
  };
}

/** Safari 13 has the print media query but not its event target, and there the print events are the
 *  only word. */
function watchMedia(onChange: (e: MediaQueryListEvent) => void): () => void {
  try {
    const media = window.matchMedia("print");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  } catch {
    return () => undefined;
  }
}

/** The shell answers with a promise, and a thenable from another realm is the same answer. */
const thenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function";

/** Named per sheet, so an older print cannot retire the one that replaced it. */
function retire(sheet: HTMLDivElement | undefined): void {
  if (!standing || standing.sheet !== sheet) return;
  const { url, stop } = standing;
  standing = undefined;
  stop();
  arm(false);
  sheet.remove();
  URL.revokeObjectURL(url);
}

const arm = (on: boolean): void => {
  document.documentElement.classList.toggle(PRINTING_CLASS, on);
};

/** The print decides this outcome, not the call that starts it. Settling twice is how the paths
 *  overlap on purpose: the first reason wins and every later one is a no-op. */
function deferred(): { promise: Promise<void>; settle: (failure?: unknown) => void } {
  let settle: (failure?: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    settle = (failure) => (failure === undefined ? resolve() : reject(failure));
  });
  return { promise, settle };
}

/** Awaited before the print, or the sheet spools blank. No deadline, because the caller renders
 *  first and hands over local bytes. */
async function imageReady(img: HTMLImageElement): Promise<void> {
  if (img.complete) return;
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("the label image could not be loaded"));
  });
  if (!img.decode) return loaded;
  return img.decode().catch(() => loaded);
}
