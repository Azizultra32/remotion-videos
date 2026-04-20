import { describe, it, expect } from "vitest";
import {
  parseKeyPattern,
  matchesEvent,
  dispatchBindings,
  type ShortcutBinding,
} from "../src/utils/shortcuts";

const mkEvent = (init: {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean };
}): KeyboardEvent => {
  const e = {
    key: init.key,
    shiftKey: !!init.shiftKey,
    metaKey: !!init.metaKey,
    ctrlKey: !!init.ctrlKey,
    altKey: !!init.altKey,
    target: init.target ?? null,
    defaultPrevented: false,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as KeyboardEvent;
  return e;
};

describe("parseKeyPattern", () => {
  it("parses a bare key", () => {
    expect(parseKeyPattern("Space")).toEqual({
      key: " ",
      shift: false,
      ctrl: false,
      meta: false,
      alt: false,
    });
  });

  it("parses named keys case-insensitively", () => {
    expect(parseKeyPattern("arrowleft").key).toBe("ArrowLeft");
    expect(parseKeyPattern("ArrowLeft").key).toBe("ArrowLeft");
  });

  it("parses modifier combinations", () => {
    const parsed = parseKeyPattern("shift+ArrowRight");
    expect(parsed.key).toBe("ArrowRight");
    expect(parsed.shift).toBe(true);
  });

  it("treats Cmd as Meta", () => {
    const parsed = parseKeyPattern("Cmd+Z");
    expect(parsed.meta).toBe(true);
    expect(parsed.key).toBe("z");
  });

  it("throws on empty pattern", () => {
    expect(() => parseKeyPattern("")).toThrow();
  });
});

describe("matchesEvent", () => {
  it("matches a bare key", () => {
    const e = mkEvent({ key: " " });
    expect(matchesEvent(e, parseKeyPattern("Space"))).toBe(true);
  });

  it("requires all modifiers specified to be set", () => {
    expect(
      matchesEvent(mkEvent({ key: "ArrowLeft", shiftKey: true }), parseKeyPattern("shift+ArrowLeft")),
    ).toBe(true);
    expect(
      matchesEvent(mkEvent({ key: "ArrowLeft" }), parseKeyPattern("shift+ArrowLeft")),
    ).toBe(false);
  });

  it("requires modifiers not specified to be unset (strict match)", () => {
    // Pattern "ArrowRight" should NOT match shift+ArrowRight
    expect(
      matchesEvent(mkEvent({ key: "ArrowRight", shiftKey: true }), parseKeyPattern("ArrowRight")),
    ).toBe(false);
  });

  it("matches keys case-insensitively", () => {
    // Event.key for a letter can be "z" or "Z" depending on shift
    expect(matchesEvent(mkEvent({ key: "z", metaKey: true }), parseKeyPattern("Cmd+Z"))).toBe(true);
    expect(matchesEvent(mkEvent({ key: "Z", metaKey: true }), parseKeyPattern("Cmd+Z"))).toBe(true);
  });
});

describe("dispatchBindings", () => {
  const makeBinding = (pattern: string, context: string, alwaysAllow = false): ShortcutBinding & { fired: number } => {
    const b = {
      pattern,
      context,
      handler: () => {
        b.fired++;
      },
      fired: 0,
      alwaysAllow,
    };
    return b as ShortcutBinding & { fired: number };
  };

  it("fires the handler for a matching binding in an active context", () => {
    const b = makeBinding("Space", "global");
    dispatchBindings(mkEvent({ key: " " }), ["global"], [b]);
    expect(b.fired).toBe(1);
  });

  it("does NOT fire when the context is not on the stack", () => {
    const b = makeBinding("Space", "timeline");
    dispatchBindings(mkEvent({ key: " " }), ["global"], [b]);
    expect(b.fired).toBe(0);
  });

  it("fires the most-specific binding (top of stack wins)", () => {
    const global = makeBinding("F", "global");
    const local = makeBinding("F", "timeline");
    // Stack order: top-of-stack is LAST (most specific)
    dispatchBindings(mkEvent({ key: "F" }), ["global", "timeline"], [global, local]);
    expect(local.fired).toBe(1);
    expect(global.fired).toBe(0);
  });

  it("suppresses all bindings when the event target is an editable element (default)", () => {
    const b = makeBinding("Space", "global");
    const e = mkEvent({ key: " ", target: { tagName: "INPUT" } });
    dispatchBindings(e, ["global"], [b]);
    expect(b.fired).toBe(0);
  });

  it("suppresses bindings in a TEXTAREA", () => {
    const b = makeBinding("Space", "global");
    dispatchBindings(mkEvent({ key: " ", target: { tagName: "TEXTAREA" } }), ["global"], [b]);
    expect(b.fired).toBe(0);
  });

  it("suppresses bindings in a contenteditable", () => {
    const b = makeBinding("Space", "global");
    dispatchBindings(mkEvent({ key: " ", target: { isContentEditable: true } }), ["global"], [b]);
    expect(b.fired).toBe(0);
  });

  it("fires alwaysAllow bindings even when target is editable", () => {
    const always = makeBinding("Escape", "global", true);
    dispatchBindings(mkEvent({ key: "Escape", target: { tagName: "INPUT" } }), ["global"], [always]);
    expect(always.fired).toBe(1);
  });

  it("returns true when a binding fired, false when no handler ran", () => {
    const b = makeBinding("Space", "global");
    const fired = dispatchBindings(mkEvent({ key: " " }), ["global"], [b]);
    expect(fired).toBe(true);
    const nothing = dispatchBindings(mkEvent({ key: "x" }), ["global"], [b]);
    expect(nothing).toBe(false);
  });
});
