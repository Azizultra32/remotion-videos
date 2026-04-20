import { beforeEach, describe, expect, it } from "vitest";
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
      events: [],
      compositionDuration: 90,
      fps: 24,
      snapMode: "beat",
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

  it("setSnapMode cycles through all 4 modes", () => {
    useEditorStore.getState().setSnapMode("off");
    expect(useEditorStore.getState().snapMode).toBe("off");
    useEditorStore.getState().setSnapMode("half-beat");
    expect(useEditorStore.getState().snapMode).toBe("half-beat");
    useEditorStore.getState().setSnapMode("downbeat");
    expect(useEditorStore.getState().snapMode).toBe("downbeat");
  });

  it("selectElement sets and clears selection", () => {
    useEditorStore.getState().selectElement("el-42");
    expect(useEditorStore.getState().selectedElementId).toBe("el-42");
    useEditorStore.getState().selectElement(null);
    expect(useEditorStore.getState().selectedElementId).toBeNull();
  });

  it("setElementLocked toggles locked field", () => {
    const store = useEditorStore.getState();
    store.addElement({
      id: "t1",
      type: "text.bellCurve",
      trackIndex: 0,
      startSec: 1,
      durationSec: 1,
      label: "x",
      props: {},
    });
    expect(useEditorStore.getState().elements[0].locked).toBeFalsy();
    store.setElementLocked("t1", true);
    expect(useEditorStore.getState().elements[0].locked).toBe(true);
    store.setElementLocked("t1", false);
    expect(useEditorStore.getState().elements[0].locked).toBe(false);
    store.removeElement("t1");
  });

  describe("named time events", () => {
    it("setEvents replaces the list", () => {
      useEditorStore.getState().setEvents([{ name: "drop", timeSec: 30 }]);
      expect(useEditorStore.getState().events).toEqual([{ name: "drop", timeSec: 30 }]);
    });

    it("upsertEventMark adds a new entry", () => {
      useEditorStore.getState().upsertEventMark("drop", 12);
      expect(useEditorStore.getState().events).toEqual([{ name: "drop", timeSec: 12 }]);
    });

    it("upsertEventMark updates an existing entry by name", () => {
      useEditorStore.getState().upsertEventMark("drop", 12);
      useEditorStore.getState().upsertEventMark("drop", 30);
      const events = useEditorStore.getState().events;
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ name: "drop", timeSec: 30 });
    });

    it("removeEventMark drops by name", () => {
      useEditorStore.getState().setEvents([
        { name: "a", timeSec: 1 },
        { name: "b", timeSec: 2 },
      ]);
      useEditorStore.getState().removeEventMark("a");
      expect(useEditorStore.getState().events.map((e) => e.name)).toEqual(["b"]);
    });

    it("renameEventMark renames an event", () => {
      useEditorStore.getState().setEvents([{ name: "old", timeSec: 1 }]);
      useEditorStore.getState().renameEventMark("old", "new");
      expect(useEditorStore.getState().events[0].name).toBe("new");
    });

    it("renameEventMark is a no-op when new name collides", () => {
      useEditorStore.getState().setEvents([
        { name: "a", timeSec: 1 },
        { name: "b", timeSec: 2 },
      ]);
      useEditorStore.getState().renameEventMark("a", "b");
      expect(useEditorStore.getState().events).toEqual([
        { name: "a", timeSec: 1 },
        { name: "b", timeSec: 2 },
      ]);
    });

    it("setTrack clears events along with elements", () => {
      useEditorStore.getState().setEvents([{ name: "drop", timeSec: 5 }]);
      useEditorStore.getState().setTrack("projects/foo/audio.mp3", "projects/foo/analysis.json");
      expect(useEditorStore.getState().events).toEqual([]);
    });
  });
});


describe("sections slice", () => {
  it("addSection appends a new section", () => {
    useEditorStore.setState({ sections: [] });
    useEditorStore.getState().addSection({
      id: "s1",
      name: "Intro",
      startSec: 0,
      endSec: 30,
      type: "intro",
      color: "#5f8fbf",
    });
    expect(useEditorStore.getState().sections).toHaveLength(1);
    expect(useEditorStore.getState().sections[0].name).toBe("Intro");
  });

  it("updateSection patches the matching id only", () => {
    useEditorStore.setState({
      sections: [
        { id: "s1", name: "Intro", startSec: 0, endSec: 30, type: "intro", color: "#5f8fbf" },
        { id: "s2", name: "Build", startSec: 30, endSec: 60, type: "build", color: "#bf9f5f" },
      ],
    });
    useEditorStore.getState().updateSection("s2", { endSec: 90 });
    const sections = useEditorStore.getState().sections;
    expect(sections[0].endSec).toBe(30);
    expect(sections[1].endSec).toBe(90);
    expect(sections[1].name).toBe("Build");
  });

  it("removeSection filters by id", () => {
    useEditorStore.setState({
      sections: [
        { id: "s1", name: "Intro", startSec: 0, endSec: 30, type: "intro", color: "#5f8fbf" },
        { id: "s2", name: "Build", startSec: 30, endSec: 60, type: "build", color: "#bf9f5f" },
      ],
    });
    useEditorStore.getState().removeSection("s1");
    expect(useEditorStore.getState().sections).toHaveLength(1);
    expect(useEditorStore.getState().sections[0].id).toBe("s2");
  });

  it("setSections replaces the whole array", () => {
    useEditorStore.setState({
      sections: [{ id: "old", name: "x", startSec: 0, endSec: 1, type: "custom", color: "#888" }],
    });
    useEditorStore.getState().setSections([
      { id: "new", name: "Intro", startSec: 0, endSec: 30, type: "intro", color: "#5f8fbf" },
    ]);
    const s = useEditorStore.getState().sections;
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe("new");
  });
});
