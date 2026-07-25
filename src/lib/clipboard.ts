export type CopyResult = "copied" | "denied" | "unsupported";

/** Deprecated execCommand path, kept only as the last resort where the async
 *  clipboard API is unavailable (plain-HTTP self-hosting, some WebViews). */
function copyViaExecCommand(text: string): CopyResult {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok: boolean;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok ? "copied" : "unsupported";
}

/** Single seam for copying text: async clipboard API when present, otherwise
 *  the execCommand fallback, so copy works outside secure contexts too. */
export async function copyText(text: string): Promise<CopyResult> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      // Permission denied (or user dismissal); execCommand won't do better.
      return "denied";
    }
  }
  return copyViaExecCommand(text);
}
