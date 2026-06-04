// TYPE-ONLY import (erased at compile) → this module stays runtime-clean and jest-testable
// without the native module. See features/__tests__/detection.test.ts.
import type { Detection } from 'expo-ar';

export type Size = { width: number; height: number };
export type Rect = { id: string; label: string; x: number; y: number; w: number; h: number };

/**
 * CV-fusion demo helpers — all pure, so the detect feature holds no AR state. The native processor
 * (Apple Vision on iOS, ML Kit on Android — see example/modules/ar-detectors) emits Detections via
 * onDetections; these helpers turn that batch into something the HUD/Skia overlay can draw and act on.
 */

/** Highest-confidence detection, or null for an empty batch. Used to auto-pick a target. */
export const topDetection = (dets: Detection[]): Detection | null =>
  dets.reduce<Detection | null>((best, d) => (best && best.confidence >= d.confidence ? best : d), null);

/** Detections that hit a real surface (worldTransform != null) — the only ones you can anchor on. */
export const placeable = (dets: Detection[]): Detection[] => dets.filter((d) => d.worldTransform != null);

/**
 * Scale a view-normalized bbox (0–1, already orientation-corrected natively) to pixel rects for a
 * Skia canvas sized to the view. Kept separate from rendering so it's unit-testable.
 */
export const bboxToRects = (dets: Detection[], size: Size): Rect[] =>
  dets.map((d) => ({
    id: d.id,
    label: d.label,
    x: d.bbox.x * size.width,
    y: d.bbox.y * size.height,
    w: d.bbox.w * size.width,
    h: d.bbox.h * size.height,
  }));

/** Format a measured distance (meters) for the readout, switching to cm under a meter. */
export const formatMeters = (m: number | null): string => {
  if (m == null) return '—';
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`;
};
