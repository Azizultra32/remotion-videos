import { describe, it, expect, beforeEach } from "vitest";
import { applyMutations } from "../src/utils/applyMutations";
import { useEditorStore } from "../src/store";

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

describe("applyMutations · events", () => {
  it("addEvent creates a new named event", () => {
    const r = applyMutations([{ op: "addEvent", name: "drop1", timeSec: 30 }]);
    expect(r.applied).toBe(1);
    expect(r.skipped).toBe(0);
    expect(useEditorStore.getState().events).toEqual([
      { name: "drop1", timeSec: 30 },
    ]);
  });

  it("addEvent is idempotent on the same name (updates time)", () => {
    applyMutations([{ op: "addEvent", name: "drop1", timeSec: 10 }]);
    applyMutations([{ op: "addEvent", name: "drop1", timeSec: 30 }]);
    const events = useEditorStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].timeSec).toBe(30);
  });

  it("addEvent rejects missing name", () => {
    const r = applyMutations([{ op: "addEvent", timeSec: 30 }]);
    expect(r.applied).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.errors[0]).toMatch(/name required/);
  });

  it("addEvent rejects negative timeSec", () => {
    const r = applyMutations([
      { op: "addEvent", name: "x", timeSec: -1 },
    ]);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/non-negative/);
  });

  it("moveEvent updates an existing event", () => {
    applyMutations([{ op: "addEvent", name: "drop1", timeSec: 10 }]);
    const r = applyMutations([
      { op: "moveEvent", name: "drop1", timeSec: 42 },
    ]);
    expect(r.applied).toBe(1);
    expect(useEditorStore.getState().events[0].timeSec).toBe(42);
  });

  it("moveEvent rejects when name is absent", () => {
    const r = applyMutations([
      { op: "moveEvent", name: "ghost", timeSec: 10 },
    ]);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/no event "ghost"/);
  });

  it("renameEvent renames an existing event", () => {
    applyMutations([{ op: "addEvent", name: "old", timeSec: 5 }]);
    const r = applyMutations([
      { op: "renameEvent", oldName: "old", newName: "new" },
    ]);
    expect(r.applied).toBe(1);
    expect(useEditorStore.getState().events[0].name).toBe("new");
  });

  it("renameEvent rejects when oldName is absent", () => {
    const r = applyMutations([
      { op: "renameEvent", oldName: "ghost", newName: "x" },
    ]);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/no event "ghost"/);
  });

  it("renameEvent rejects on collision with existing newName", () => {
    applyMutations([{ op: "addEvent", name: "a", timeSec: 1 }]);
    applyMutations([{ op: "addEvent", name: "b", timeSec: 2 }]);
    const r = applyMutations([
      { op: "renameEvent", oldName: "a", newName: "b" },
    ]);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/already exists/);
  });

  it("removeEvent drops a named event", () => {
    applyMutations([{ op: "addEvent", name: "x", timeSec: 1 }]);
    const r = applyMutations([{ op: "removeEvent", name: "x" }]);
    expect(r.applied).toBe(1);
    expect(useEditorStore.getState().events).toEqual([]);
  });

  it("removeEvent rejects when name is absent", () => {
    const r = applyMutations([{ op: "removeEvent", name: "missing" }]);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/no event "missing"/);
  });

  it("a mixed batch applies good ops and records errors for bad ones", () => {
    const r = applyMutations([
      { op: "addEvent", name: "ok", timeSec: 1 },
      { op: "moveEvent", name: "ghost", timeSec: 2 },
      { op: "addEvent", name: "ok2", timeSec: 3 },
    ]);
    expect(r.applied).toBe(2);
    expect(r.skipped).toBe(1);
    const names = useEditorStore.getState().events.map((e) => e.name).sort();
    expect(names).toEqual(["ok", "ok2"]);
  });
});
