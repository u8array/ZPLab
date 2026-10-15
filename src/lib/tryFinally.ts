/** The React Compiler cannot lower a try/finally inside a hook, so the finally lives here.
 *  `body` is a closure, so a return inside it leaves only the closure. */
export function tryFinally(body: () => void, cleanup: () => void): void {
  try {
    body();
  } finally {
    cleanup();
  }
}
