// Pure scheduling combinators lifted from MC's flow API
// (packages/core/src/flow/{all,chain,sequence,delay,scheduling}.ts).
//
// MC uses these inside generator functions to compose timings imperatively.
// We compile the same primitives AHEAD of time to concrete {startSec, endSec}
// ranges that Remotion's <Sequence>, <Series>, or manual composition code can
// consume. No generator runtime, no async scheduling — just math.

export type FlowNode = {
  kind: "leaf" | "chain" | "all" | "sequence" | "delay" | "wait";
  durationSec: number;
  // Leaves carry an id consumers can use to address the range at compile
  // time (e.g. "fadeIn.a"). Non-leaves don't have one by default.
  id?: string;
  children?: FlowNode[];
  // Sequence stepSec between consecutive children.
  stepSec?: number;
  // Delay offset in seconds (for the "delay" kind).
  offsetSec?: number;
};

export type FlowRange = {
  id: string;
  startSec: number;
  endSec: number;
};

const requireNonNegativeFinite = (n: number, label: string): void => {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label}: expected non-negative finite number, got ${n}`);
  }
};

export const leaf = (id: string, durationSec: number): FlowNode => {
  requireNonNegativeFinite(durationSec, "leaf.durationSec");
  return { kind: "leaf", id, durationSec };
};

export const waitFor = (sec: number): FlowNode => {
  requireNonNegativeFinite(sec, "waitFor");
  return { kind: "wait", durationSec: sec };
};

export const chain = (children: FlowNode[]): FlowNode => {
  let total = 0;
  for (const c of children) total += c.durationSec;
  return { kind: "chain", durationSec: total, children };
};

export const all = (children: FlowNode[]): FlowNode => {
  let max = 0;
  for (const c of children) {
    if (c.durationSec > max) max = c.durationSec;
  }
  return { kind: "all", durationSec: max, children };
};

export const delay = (offsetSec: number, child: FlowNode): FlowNode => {
  requireNonNegativeFinite(offsetSec, "delay.offsetSec");
  return {
    kind: "delay",
    durationSec: offsetSec + child.durationSec,
    offsetSec,
    children: [child],
  };
};

export const sequence = (
  stepSec: number,
  children: FlowNode[],
): FlowNode => {
  requireNonNegativeFinite(stepSec, "sequence.stepSec");
  if (children.length === 0) {
    return { kind: "sequence", durationSec: 0, stepSec, children };
  }
  let maxEnd = 0;
  for (let i = 0; i < children.length; i++) {
    const end = i * stepSec + children[i].durationSec;
    if (end > maxEnd) maxEnd = end;
  }
  return { kind: "sequence", durationSec: maxEnd, stepSec, children };
};

// Walk the tree and collect every leaf as a concrete {id, startSec, endSec}
// range. Non-leaf nodes (chain/all/sequence/delay/wait) contribute only to
// the time cursor.
export const compile = (root: FlowNode): FlowRange[] => {
  const out: FlowRange[] = [];
  const walk = (node: FlowNode, baseStart: number): void => {
    switch (node.kind) {
      case "leaf":
        if (node.id !== undefined) {
          out.push({
            id: node.id,
            startSec: baseStart,
            endSec: baseStart + node.durationSec,
          });
        }
        return;
      case "wait":
        return;
      case "chain": {
        let cursor = baseStart;
        for (const c of node.children ?? []) {
          walk(c, cursor);
          cursor += c.durationSec;
        }
        return;
      }
      case "all":
        for (const c of node.children ?? []) walk(c, baseStart);
        return;
      case "sequence": {
        const step = node.stepSec ?? 0;
        const kids = node.children ?? [];
        for (let i = 0; i < kids.length; i++) {
          walk(kids[i], baseStart + i * step);
        }
        return;
      }
      case "delay": {
        const offset = node.offsetSec ?? 0;
        const child = node.children?.[0];
        if (child) walk(child, baseStart + offset);
        return;
      }
    }
  };
  walk(root, 0);
  return out;
};
