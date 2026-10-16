// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ImportFinding } from "@zplab/core/lib/importReport";
import { ImportSetupChoice } from "./ImportSetupChoice";
import { fallbackTranslations as en } from "../../locales";
import { formatTemplate } from "../../lib/formatTemplate";

afterEach(cleanup);

const setup: ImportFinding = { kind: "replayRisk", command: "^JUS", pageIndex: 0 };

describe("ImportSetupChoice", () => {
  it("names the commands a routed page loses, and stays quiet when nothing is lost", () => {
    const lost = render(<ImportSetupChoice findings={[setup]} lost={["~JC"]} canKeep onChoose={() => undefined} />);
    expect(lost.getByRole("status").textContent).toBe(formatTemplate(en.app.importSetupDropsFmt, { commands: "~JC" }));
    cleanup();
    const clean = render(<ImportSetupChoice findings={[setup]} lost={[]} canKeep onChoose={() => undefined} />);
    expect(clean.queryByRole("status")).toBeNull();
  });
});
