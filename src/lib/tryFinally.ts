/** Keeps the finally out of a component or hook, where the React Compiler cannot lower it.
 *  A `return` inside `body` leaves `body`, not the caller. */
export function tryFinally(body: () => void, cleanup: () => void): void {
  try {
    body();
  } finally {
    cleanup();
  }
}
