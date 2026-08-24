// @vitest-environment jsdom
import { createRef } from "react";
import { DndContext } from "@dnd-kit/core";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ObjectPalette } from "./Palette/ObjectPalette";
import { RightSidebar } from "./RightSidebar/RightSidebar";
import { useLabelStore } from "../store/labelStore";
import type { LabelCanvasHandle } from "./Canvas/LabelCanvas";

afterEach(cleanup);

beforeEach(() => {
  act(() => {
    useLabelStore.setState({
      previewMode: { status: "idle" },
      sourceEdit: { status: "off" },
      selectedIds: [],
    });
  });
});

const freezes = {
  "source edit": () =>
    useLabelStore.setState({
      sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 99 },
    }),
  preview: () =>
    useLabelStore.setState({ previewMode: { status: "active", url: "blob:x" } }),
} as const;

describe.each(Object.entries(freezes))("frozen sidebars under %s", (_name, freeze) => {
  it("makes the palette inert", () => {
    const { container } = render(
      <DndContext>
        <ObjectPalette />
      </DndContext>,
    );
    expect(container.querySelector("[inert]")).toBeNull();
    act(() => freeze());
    expect(container.querySelector("[inert]")).not.toBeNull();
  });

  it("makes the right sidebar panel content inert, tabs stay live", () => {
    const { container } = render(
      <RightSidebar canvasRef={createRef<LabelCanvasHandle | null>()} />,
    );
    expect(container.querySelector("[inert]")).toBeNull();
    act(() => freeze());
    const inert = container.querySelector("[inert]");
    expect(inert).not.toBeNull();
    expect(inert?.querySelector("[role=tab]")).toBeNull();
  });
});
