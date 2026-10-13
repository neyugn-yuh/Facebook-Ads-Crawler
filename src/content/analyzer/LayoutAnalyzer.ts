import type { Rect } from '../../shared/types';
import { round } from '../../shared/utils';

export function toRect(r: DOMRect): Rect {
  return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) };
}

export function viewportInfo() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

/** Viewport mở rộng thêm `margin` lần chiều cao về 2 phía. */
export function intersectsViewport(r: DOMRect, margin = 1): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return r.right >= -vw * margin && r.left <= vw * (1 + margin) && r.bottom >= -vh * margin && r.top <= vh * (1 + margin);
}

export function sameRect(a: DOMRect, b: DOMRect, tol = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) <= tol &&
    Math.abs(a.y - b.y) <= tol &&
    Math.abs(a.width - b.width) <= tol &&
    Math.abs(a.height - b.height) <= tol
  );
}
