/** Centralises the `e instanceof Error ? ... : String(e)` coercion every
 *  async/catch site would otherwise repeat. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
