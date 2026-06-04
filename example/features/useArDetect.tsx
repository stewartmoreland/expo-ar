import { getDetectorInfo, useArDetection, useArSession, type Detection } from 'expo-ar';
import { useCallback, useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { placeable, topDetection } from './detection';

// Name the example's registered processor is keyed under (matches App.tsx detectionModel + the
// native ArDetectorsModule registrations).
const DETECTOR = 'objects';

// The native side renders a built-in primitive for any URI it can't load as a real model, so the
// demo is self-contained (same convention as the placement demo).
const DEFAULT_MODEL_URI = 'builtin:cube';

// CV-fusion demo hook. Composes the SAME core (useArSession: tracking/anchors/reset) with the
// module's useArDetection (which consumes onDetections + exposes addAnchorAtWorld/raycast fusion),
// sharing ONE view ref. Detection inference runs natively in the registered processor (Vision /
// ML Kit); JS only receives results and drives the two fusion modes:
//   - detect-then-place  → anchor the top detection's world transform, attach a model
//   - detect-then-measure → raycast the top detection's box edges, report real width
export function useArDetect() {
  const ar = useArSession();
  const { width, height } = useWindowDimensions();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [lastMeasure, setLastMeasure] = useState<number | null>(null);
  const det = useArDetection({ ref: ar.ref, onDetections: setDetections });

  // Which detector actually loaded (e.g. "YOLOv3" vs the animal fallback) — surfaced in the HUD so a
  // dropped Core ML model that silently fell back is obvious without reading Xcode logs.
  const [detector, setDetector] = useState<string>('');
  useEffect(() => {
    try {
      const info = getDetectorInfo(DETECTOR);
      setDetector(info.available ? info.label : 'none registered');
    } catch {
      setDetector('');
    }
  }, []);

  // detect-then-place: pick the highest-confidence detection that actually hit a surface, anchor at
  // its world transform (no redundant raycast), then attach a model — reusing the core's renderer.
  const placeTop = useCallback(async () => {
    const target = topDetection(placeable(detections));
    if (!target) return;
    const id = await det.place(target);
    if (id) await ar.ref.current?.attachModel?.(id, DEFAULT_MODEL_URI);
  }, [detections, det, ar.ref]);

  // detect-then-measure: real-world width of the highest-confidence detection (raycasts its left/right
  // edges). Accuracy depends on a surface behind the box — best on/against a plane or with depth on.
  const measureTop = useCallback(async () => {
    const target = topDetection(detections);
    if (!target) return;
    setLastMeasure(await det.measureWidth(target, { width, height }));
  }, [detections, det, width, height]);

  const clear = useCallback(() => {
    setLastMeasure(null);
    setDetections([]);
    void ar.reset();
  }, [ar]);

  return {
    ...ar,
    detections,
    detector,
    lastMeasure,
    size: { width, height },
    placeTop,
    measureTop,
    clear,
    // Merge session + detection event handlers (disjoint event names) onto one <ExpoArView>.
    handlers: { ...ar.handlers, ...det.handlers },
  };
}
