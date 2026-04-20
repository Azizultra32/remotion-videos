// Pure drag-position math for the floating preview window. Tested in
// isolation so the component doesn't have to re-invent clamping logic
// inside pointer event handlers.

export type Pos = { x: number; y: number };

export type DragBounds = {
  viewportW: number;
  viewportH: number;
  width: number;
  height: number;
};

export const computeDragPosition = (
  startPos: Pos,
  delta: Pos,
  bounds: DragBounds,
): Pos => {
  const maxX = Math.max(0, bounds.viewportW - bounds.width);
  const maxY = Math.max(0, bounds.viewportH - bounds.height);
  return {
    x: Math.max(0, Math.min(maxX, startPos.x + delta.x)),
    y: Math.max(0, Math.min(maxY, startPos.y + delta.y)),
  };
};
