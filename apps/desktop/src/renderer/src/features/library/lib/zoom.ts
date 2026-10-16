import { clamp } from "@/shared/lib/math";

const ZOOM_MIN = 80;
const ZOOM_MAX = 360;
export const ZOOM_DEFAULT = 130;
export const ZOOM_STORAGE_KEY = "pond.gridZoom";

export const ZOOM_STEPS: ReadonlyArray<{ value: number; label: string }> = [
  { value: ZOOM_MIN, label: "Tiny" },
  { value: 105, label: "Small" },
  { value: ZOOM_DEFAULT, label: "Medium" },
  { value: 155, label: "Large" },
  { value: 185, label: "Huge" },
  { value: 215, label: "Extra Large" },
  { value: 240, label: "Giant" },
  { value: 280, label: "280 px" },
  { value: 320, label: "320 px" },
  { value: ZOOM_MAX, label: "360 px" },
];

export function clampZoom(n: number): number {
  return clamp(n, ZOOM_MIN, ZOOM_MAX);
}

export function nearestZoomIndex(zoom: number): number {
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  ZOOM_STEPS.forEach((step, index) => {
    const delta = Math.abs(zoom - step.value);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}
