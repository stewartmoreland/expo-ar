import { useCallback, useRef, type RefObject } from 'react';

import { DetectionsEvent, type ArViewHandle, type Detection } from './ExpoAr.types';
import { distanceBetween } from './transform';

// Like useArSession, this file imports ONLY from './ExpoAr.types' (+ './transform' + react) —
// never the native module — so it loads under jest with no native runtime.

export type ViewSize = { width: number; height: number };

/**
 * CV-fusion feature hook (sibling of useArSession). Consumes the throttled `onDetections` event
 * and exposes the two fusion modes from the cv-fusion reference:
 *
 *  - **detect-then-place** — `place(d)` anchors at the detection's same-frame world transform via
 *    the core `addAnchorAtWorld` primitive; the returned id feeds `attachModel` for rendering.
 *  - **detect-then-measure** — `measureWidth(d, viewSize)` raycasts the two opposite bbox-mid
 *    corners and returns the real distance in meters.
 *
 * Wire `ref` to <ExpoArView/> and spread `handlers` onto its event props. The latest detections
 * live in a ref (`latest`) — not React state — so a per-frame Skia overlay can read them without
 * forcing an RN re-render at detection cadence. Pass an `onDetections` callback for screens that
 * DO want to drive React state (e.g. a tappable list).
 */
export function useArDetection(opts?: {
  // Accepts a useArSession-style ref (React 19's useRef<T>(null) is RefObject<T | null>), so callers
  // can share ONE ref across useArSession + useArDetection on a single <ExpoArView>.
  ref?: RefObject<ArViewHandle | null>;
  onDetections?: (d: Detection[]) => void;
}) {
  const internalRef = useRef<ArViewHandle>(null);
  const ref = opts?.ref ?? internalRef;
  // Mutable latest batch for per-frame consumers (Skia). Not state — avoids re-render churn.
  const latest = useRef<Detection[]>([]);
  const onDetectionsCb = opts?.onDetections;

  const onDetections = useCallback(
    (e: { nativeEvent: unknown }) => {
      const { detections } = DetectionsEvent.parse(e.nativeEvent);
      latest.current = detections;
      onDetectionsCb?.(detections);
    },
    [onDetectionsCb]
  );

  // Anchor at the detection's world transform (skips a redundant raycast — CV already has it).
  const place = useCallback(
    async (d: Detection): Promise<string | null> => {
      if (!d.worldTransform) return null; // nothing solid behind the box
      const res = await ref.current?.addAnchorAtWorld?.(d.worldTransform);
      return res?.id ?? null;
    },
    [ref]
  );

  // Real-world width of a detection: raycast the left- and right-edge midpoints and measure between.
  //
  // Accuracy caveat: box corners raycast to whatever surface is *behind* them, so this reads an
  // object's footprint/silhouette against a backdrop, not a free-floating object's true extent. It
  // is reliable when the object sits on/against a detected plane, and far better with LiDAR/Depth on.
  const measureWidth = useCallback(
    async (d: Detection, viewSize: ViewSize): Promise<number | null> => {
      const { x, y, w, h } = d.bbox;
      const midY = (y + h / 2) * viewSize.height;
      const left = await ref.current?.raycast(x * viewSize.width, midY);
      const right = await ref.current?.raycast((x + w) * viewSize.width, midY);
      if (left?.worldTransform && right?.worldTransform) {
        return distanceBetween(left.worldTransform, right.worldTransform);
      }
      return null;
    },
    [ref]
  );

  return {
    ref,
    /** Mutable ref to the most recent detection batch — read directly from a per-frame overlay. */
    latest,
    place,
    measureWidth,
    handlers: { onDetections },
  };
}
