import { useArSession } from 'expo-ar';
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { measure } from './measurement';

// Measurement composes the core session and adds NOTHING to it — it derives geometry
// from the anchors the core already manages. Undo/clear reuse the core's
// removeAnchor/reset. This is the genericity proof: no new session/tracking code.
export function useArMeasure() {
  const ar = useArSession();
  const { width, height } = useWindowDimensions();
  const result = useMemo(() => measure(ar.anchors), [ar.anchors]);

  // Place a point at screen center (the reticle). addAnchor raycasts + creates the
  // anchor and fires onAnchorsChange, which the hook folds into `anchors` → `result`.
  const addPointAtCenter = () => {
    if (!ar.ready) return;
    ar.ref.current?.addAnchor(width / 2, height / 2).catch(() => {
      /* no surface at center — onError already fired */
    });
  };

  // Place a point wherever the user tapped (wire to the view's onTap).
  const addPointAt = (x: number, y: number) => {
    if (!ar.ready) return;
    ar.ref.current?.addAnchor(x, y).catch(() => {});
  };

  const undo = () => {
    const last = ar.anchors[ar.anchors.length - 1];
    if (last) ar.ref.current?.removeAnchor(last.id).catch(() => {});
  };

  const clear = () => {
    ar.reset();
  };

  return { ...ar, ...result, addPointAtCenter, addPointAt, undo, clear };
}
