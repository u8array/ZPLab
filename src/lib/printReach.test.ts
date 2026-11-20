import { afterEach, describe, expect, it, vi } from "vitest";

const shell = vi.hoisted(() => ({ isDesktopShell: false }));
vi.mock("./platform", () => shell);

async function build(apiUrl: string | undefined, desktop = false) {
  vi.resetModules();
  shell.isDesktopShell = desktop;
  if (apiUrl !== undefined) vi.stubEnv("VITE_SERVER_API_URL", apiUrl);
  return import("./printReach");
}

afterEach(() => vi.unstubAllEnvs());

describe("printReach", () => {
  it("reaches the server only in the build that names its API", async () => {
    expect((await build(undefined)).printReach).toEqual({ desktop: false, server: false });
    expect((await build("  ")).printReach).toEqual({ desktop: false, server: false });
    const served = await build(" /api/v1/ ");
    expect(served.serverApiBase).toBe("/api/v1");
    expect(served.printReach).toEqual({ desktop: false, server: true });
  });

  it("keeps the desktop shell off the server, whatever the build names", async () => {
    expect((await build("/api/v1", true)).printReach).toEqual({ desktop: true, server: false });
  });
});
