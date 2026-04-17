import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../src/store";
import type { TimelineElement } from "../src/types";

const blankElement = (overrides: Partial<TimelineElement> = {}): TimelineElement => ({
  id: overrides.id ?? "el-1",
  type: overrides.type ?? "text",
  trackIndex: overrides.trackIndex ?? 0,
  startSec: overrides.startSec ?? 0,
  durationSec: overrides.durationSec ?? 2,
  label: overrides.label ?? "AHURA",
  props: overrides.props ?? {},
});

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.setState({
      elements: [],
      currentTimeSec: 0,
      isPlaying: false,
      selectedElementId: null,
      beatData: null,
      compositionDuration: 90,
      fps: 24,
      snapToBeat: true,
      loopPlayback: false,
    });
  });

  it("addElement appends to the timeline", () => {
    useEditorStore.getState().addElement(blankElement());
    expect(useEditorStore.getState().elements).toHaveLength(1);
  });

  it("updateElement patches a field", () => {
    useEditorStore.getState().addElement(blankElement({ id: "x", startSec: 1 }));
    useEditorStore.getState().updateElement("x", { startSec: 5 });
    expect(useEditorStore.getState().elements[0].startSec).toBe(5);
  });

  it("removeElement drops by id", () => {
    useEditorStore.getState().addElement(blankElement({ id: "a" }));
    useEditorStore.getState().addElement(blankElement({ id: "b" }));
    useEditorStore.getState().removeElement("a");
    const ids = useEditorStore.getState().elements.map((e) => e.id);
    expect(ids).toEqual(["b"]);
  });

  it("setCurrentTime accepts number and updater function", () => {
    useEditorStore.getState().setCurrentTime(10);
    expect(useEditorStore.getState().currentTimeSec).toBe(10);
    useEditorStore.getState().setCurrentTime((t) => t + 5);
    expect(useEditorStore.getState().currentTimeSec).toBe(15);
  });

  it("snapToBeat and loopPlayback toggles flip state", () => {
    useEditorStore.getState().setSnapToBeat(false);
    expect(useEditorStore.getState().snapToBeat).toBe(false);
    useEditorStore.getState().setLoopPlayback(true);
    expect(useEditorStore.getState().loopPlayback).toBe(true);
  });

  it("selectElement sets and clears selection", () => {
    useEditorStore.getState().selectElement("el-42");
    expect(useEditorStore.getState().selectedElementId).toBe("el-42");
    useEditorStore.getState().selectElement(null);
    expect(useEditorStore.getState().selectedElementId).toBeNull();
  });
});
