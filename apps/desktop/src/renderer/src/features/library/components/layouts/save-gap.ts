import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { LIBRARY_SAVE_GAP } from "./packing";

const GAP_MIN = 0;
const GAP_MAX = 64;
const GAP_KEY = "pond.itemGap";

export const GAP_STEPS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "None" },
  { value: 4, label: "4 px" },
  { value: 8, label: "Small" },
  { value: 12, label: "12 px" },
  { value: LIBRARY_SAVE_GAP, label: "Medium" },
  { value: 24, label: "24 px" },
  { value: 32, label: "Large" },
  { value: 48, label: "48 px" },
  { value: GAP_MAX, label: "64 px" },
];

export function nearestGap(gap: number): number {
  let best = GAP_STEPS[0]?.value ?? 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const step of GAP_STEPS) {
    const delta = Math.abs(gap - step.value);
    if (delta < bestDelta) {
      best = step.value;
      bestDelta = delta;
    }
  }
  return best;
}

function readGap(): number {
  if (!globalThis.window) return LIBRARY_SAVE_GAP;
  try {
    const raw = window.localStorage.getItem(GAP_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(parsed)) return LIBRARY_SAVE_GAP;
    return Math.min(GAP_MAX, Math.max(GAP_MIN, parsed));
  } catch {
    return LIBRARY_SAVE_GAP;
  }
}

const store = new Store(readGap());

export function useLibrarySaveGap(): number {
  return useSelector(store, (gap) => gap);
}

export function setLibrarySaveGap(gap: number): void {
  const next = Math.min(GAP_MAX, Math.max(GAP_MIN, Math.round(gap)));
  if (globalThis.window) {
    try {
      window.localStorage.setItem(GAP_KEY, String(next));
    } catch {}
  }
  store.setState(() => next);
}
