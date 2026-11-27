type MenuBounds = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

export function clampMenuPosition({
  desiredLeft,
  desiredTop,
  menuWidth,
  menuHeight,
  boundsRect,
  fallbackTop,
  gap = 12,
  viewportWidth = globalThis.innerWidth,
  viewportHeight = globalThis.innerHeight,
}: {
  desiredLeft: number;
  desiredTop: number;
  menuWidth: number;
  menuHeight: number;
  boundsRect?: MenuBounds | null;
  fallbackTop?: number;
  gap?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}): { left: number; top: number } {
  const boundsLeft = Math.max(gap, (boundsRect?.left ?? 0) + gap);
  const boundsTop = Math.max(gap, (boundsRect?.top ?? 0) + gap);
  const boundsRight = Math.min(
    viewportWidth - gap,
    (boundsRect?.right ?? viewportWidth) - gap,
  );
  const boundsBottom = Math.min(
    viewportHeight - gap,
    (boundsRect?.bottom ?? viewportHeight) - gap,
  );
  const lastTop = Math.max(boundsTop, boundsBottom - menuHeight);
  return {
    left: Math.max(
      boundsLeft,
      Math.min(Math.max(boundsLeft, boundsRight - menuWidth), desiredLeft),
    ),
    top: Math.max(
      boundsTop,
      Math.min(
        lastTop,
        desiredTop + menuHeight <= boundsBottom
          ? desiredTop
          : Math.max(boundsTop, fallbackTop ?? lastTop),
      ),
    ),
  };
}
