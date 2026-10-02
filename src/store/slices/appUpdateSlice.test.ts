import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAppUpdateSlice, type AppUpdatePhase } from "./appUpdateSlice";
import { makeSlice } from "../../test/sliceHarness";
import { selectAppUpdateBusy, selectAppUpdateSettled } from "../labelStore.selectors";
import type { LabelState } from "../labelStore";

const supported = vi.fn<() => Promise<boolean>>();
const check = vi.fn<(options?: { timeout?: number }) => Promise<unknown>>();
vi.mock("../../lib/platform", () => ({ isDesktopShell: true }));
vi.mock("../../lib/appUpdate", () => ({ appUpdateSupported: () => supported() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (options?: { timeout?: number }) => check(options) }));

beforeEach(() => {
  supported.mockReset().mockResolvedValue(true);
  check.mockReset();
});

describe("app updater gate", () => {
  it("checks for updates when the install updates itself", async () => {
    check.mockResolvedValue(null);
    const { get } = makeSlice(createAppUpdateSlice);
    await get().checkForAppUpdate(true);
    expect(check).toHaveBeenCalledExactlyOnceWith({ timeout: expect.any(Number) });
    expect(get().appUpdate.phase).toBe("upToDate");
  });

  it("never reaches the updater when the install updates through its package", async () => {
    supported.mockResolvedValue(false);
    const { get } = makeSlice(createAppUpdateSlice);
    await get().checkForAppUpdate(false);
    await get().checkForAppUpdate(true);
    expect(check).not.toHaveBeenCalled();
    expect(supported).toHaveBeenCalledOnce();
    expect(get().appUpdate.phase).toBe("unsupported");
  });
});

describe("the silent startup check", () => {
  it.each([
    ["finds none", () => check.mockResolvedValue(null)],
    ["fails", () => check.mockRejectedValue(new Error("offline"))],
  ])("returns to idle when it %s", async (_, outcome) => {
    outcome();
    const { get } = makeSlice(createAppUpdateSlice);
    await get().checkForAppUpdate(false);
    expect(get().appUpdate.phase).toBe("idle");
  });

  it("keeps a click from starting a second check that could overwrite its result", async () => {
    let settle!: (update: unknown) => void;
    check.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const { get } = makeSlice(createAppUpdateSlice);
    const silent = get().checkForAppUpdate(false);
    await get().checkForAppUpdate(true);
    expect(get().appUpdate.phase).toBe("checking");
    settle({ version: "9.9.9" });
    await silent;
    expect(check).toHaveBeenCalledOnce();
    expect(get().appUpdate.phase).toBe("available");
  });
});

describe("update selectors", () => {
  const at = (phase: AppUpdatePhase["phase"]) => ({ appUpdate: { phase } }) as unknown as LabelState;

  it("counts a pending restart and a package install as settled, and a running check as busy", () => {
    expect(selectAppUpdateSettled(at("unsupported"))).toBe(true);
    expect(selectAppUpdateSettled(at("installed"))).toBe(true);
    expect(selectAppUpdateSettled(at("idle"))).toBe(false);
    expect(selectAppUpdateBusy(at("installing"))).toBe(true);
    expect(selectAppUpdateBusy(at("upToDate"))).toBe(false);
  });
});
