// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ObjectPanels } from "./panels";
import { ObjectRegistry } from "@zplab/core/registry";
import { useLabelStore } from "../store/labelStore";
import type { LeafType } from "@zplab/core/registry/leafObject";

afterEach(() => {
  cleanup();
  useLabelStore.setState({ editorFocusRequest: null });
});

const takesFocusRequest = (type: LeafType, override: object = {}) => {
  const Panel = ObjectPanels[type].PropertiesPanel;
  const props = { ...(ObjectRegistry[type].defaultProps as object), ...override };
  render(<Panel obj={{ id: "o", type, x: 0, y: 0, rotation: 0, props } as never} onChange={() => undefined} />);
  act(() => useLabelStore.getState().requestContentEditorFocus("o"));
  return useLabelStore.getState().editorFocusRequest === null;
};

// openContentEditor trusts this rule, and no panel derives its field from the flag.
describe("content field", () => {
  it.each(Object.keys(ObjectPanels) as LeafType[])("%s has one exactly when its type is bindable", (type) => {
    expect(takesFocusRequest(type)).toBe(!!ObjectRegistry[type].bindable);
  });

  it.each(["text", "code128"] as LeafType[])("a serial %s keeps one", (type) => {
    expect(takesFocusRequest(type, { content: "001", serial: { increment: 1, zplMode: "SN" } })).toBe(true);
  });

  it.each(["datamatrix", "qrcode", "code128", "gs1databar"] as LeafType[])("a GS1 %s keeps one", (type) => {
    expect(takesFocusRequest(type, { gs1: true })).toBe(true);
  });
});
