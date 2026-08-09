import { describe, it, expect } from "vitest";
import { NON_EMITTING_PROP_KEYS } from "./LabelObject";

describe("NON_EMITTING_PROP_KEYS", () => {
  it("membership lock: exactly the editor-only, never-emitted prop keys", () => {
    expect([...NON_EMITTING_PROP_KEYS].sort()).toEqual(["preSerialContent"]);
  });
});
