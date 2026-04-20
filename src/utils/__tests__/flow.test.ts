import { describe, it, expect } from "vitest";
import {
  waitFor,
  delay,
  chain,
  all,
  sequence,
  compile,
  leaf,
} from "../flow";

describe("leaf", () => {
  it("creates a node with the given id and duration", () => {
    const n = leaf("x", 2);
    expect(n.id).toBe("x");
    expect(n.durationSec).toBe(2);
  });

  it("rejects negative or NaN durations", () => {
    expect(() => leaf("x", -1)).toThrow();
    expect(() => leaf("x", NaN)).toThrow();
  });
});

describe("waitFor", () => {
  it("returns a node of the given duration with no id", () => {
    const n = waitFor(3);
    expect(n.durationSec).toBe(3);
  });

  it("rejects negative wait", () => {
    expect(() => waitFor(-1)).toThrow();
  });
});

describe("chain", () => {
  it("sums durations", () => {
    expect(chain([waitFor(1), waitFor(2)]).durationSec).toBe(3);
  });

  it("returns a zero-duration node when empty", () => {
    expect(chain([]).durationSec).toBe(0);
  });

  it("compile gives sequential startSec for each child", () => {
    const ranges = compile(chain([leaf("a", 1), leaf("b", 2), leaf("c", 0.5)]));
    expect(ranges).toEqual([
      { id: "a", startSec: 0, endSec: 1 },
      { id: "b", startSec: 1, endSec: 3 },
      { id: "c", startSec: 3, endSec: 3.5 },
    ]);
  });
});

describe("all", () => {
  it("takes the max duration of its children", () => {
    expect(all([waitFor(1), waitFor(3), waitFor(2)]).durationSec).toBe(3);
  });

  it("returns zero-duration when empty", () => {
    expect(all([]).durationSec).toBe(0);
  });

  it("compile gives every child startSec=0 and independent endSec", () => {
    const ranges = compile(all([leaf("a", 1), leaf("b", 3), leaf("c", 2)]));
    expect(ranges).toEqual([
      { id: "a", startSec: 0, endSec: 1 },
      { id: "b", startSec: 0, endSec: 3 },
      { id: "c", startSec: 0, endSec: 2 },
    ]);
  });
});

describe("delay", () => {
  it("shifts a child's start by delaySec; durationSec grows by delaySec", () => {
    const n = delay(1.5, waitFor(2));
    expect(n.durationSec).toBe(3.5);
  });

  it("compile shifts the child's range forward", () => {
    const ranges = compile(delay(1, leaf("a", 2)));
    expect(ranges).toEqual([{ id: "a", startSec: 1, endSec: 3 }]);
  });
});

describe("sequence", () => {
  it("staggers children by stepSec; total = stepSec*(n-1) + maxChildDuration", () => {
    // step=0.5, children durations [1, 2] → starts 0, 0.5; ends 1, 2.5. Total 2.5.
    expect(sequence(0.5, [waitFor(1), waitFor(2)]).durationSec).toBe(2.5);
  });

  it("compile gives staggered starts", () => {
    const ranges = compile(sequence(0.5, [leaf("a", 1), leaf("b", 1), leaf("c", 1)]));
    expect(ranges).toEqual([
      { id: "a", startSec: 0, endSec: 1 },
      { id: "b", startSec: 0.5, endSec: 1.5 },
      { id: "c", startSec: 1, endSec: 2 },
    ]);
  });

  it("rejects negative stepSec", () => {
    expect(() => sequence(-1, [])).toThrow();
  });
});

describe("compile · nested", () => {
  it("chain of alls stacks durations correctly", () => {
    // chain([ all([a=1, b=2]), all([c=3]) ]) → first all takes 2s, second takes 3s; total 5s
    const tree = chain([
      all([leaf("a", 1), leaf("b", 2)]),
      all([leaf("c", 3)]),
    ]);
    expect(tree.durationSec).toBe(5);
    expect(compile(tree)).toEqual([
      { id: "a", startSec: 0, endSec: 1 },
      { id: "b", startSec: 0, endSec: 2 },
      { id: "c", startSec: 2, endSec: 5 },
    ]);
  });

  it("delay inside chain shifts only that child", () => {
    const tree = chain([leaf("a", 1), delay(0.5, leaf("b", 1))]);
    expect(tree.durationSec).toBe(2.5);
    expect(compile(tree)).toEqual([
      { id: "a", startSec: 0, endSec: 1 },
      { id: "b", startSec: 1.5, endSec: 2.5 },
    ]);
  });

  it("waitFor inside chain just advances the cursor", () => {
    const tree = chain([leaf("a", 1), waitFor(2), leaf("b", 1)]);
    expect(tree.durationSec).toBe(4);
    expect(compile(tree)).toEqual([
      { id: "a", startSec: 0, endSec: 1 },
      { id: "b", startSec: 3, endSec: 4 },
    ]);
  });

  it("drops leaves that have zero duration gracefully", () => {
    // A zero-duration leaf is legal (useful as a marker); compile keeps it.
    const ranges = compile(chain([leaf("a", 0), leaf("b", 1)]));
    expect(ranges).toEqual([
      { id: "a", startSec: 0, endSec: 0 },
      { id: "b", startSec: 0, endSec: 1 },
    ]);
  });
});
