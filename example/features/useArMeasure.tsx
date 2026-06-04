import { ProjectionEvent, useArSession, type ProjectedPoint } from 'expo-ar';
import { useCallback, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { measure } from './measurement';

// Measurement composes the core session and adds NOTHING to it — it derives geometry
// from the anchors the core already manages. Undo/clear reuse the core's
// removeAnchor/reset. This is the genericity proof: no new session/tracking code.
//
// It DOES own the per-frame `projected` screen positions (from the opt-in onProjection
// event). That state lives here, not in useArSession, so the ~30fps updates re-render
// only the measurement screen — the use-case-agnostic core and the placement demo are
// untouched.
export function useArMeasure() {
  const ar = useArSession();
  const { width, height } = useWindowDimensions();
  const result = useMemo(() => measure(ar.anchors), [ar.anchors]);

  // Latest screen positions of the anchors, keyed by anchor id, so labels can be pinned
  // to world points that track in 3D as the device moves.
  const [projected, setProjected] = useState<Record<string, ProjectedPoint>>({});
  const onProjection = useCallback((e: { nativeEvent: unknown }) => {
    // Hot path (~30fps): trust the contract in production and only Zod-validate in dev,
    // where a native key rename should fail loudly.
    const points = __DEV__
      ? ProjectionEvent.parse(e.nativeEvent).points
      : (e.nativeEvent as ProjectionEvent).points;
    const next: Record<string, ProjectedPoint> = {};
    for (const p of points) next[p.id] = p;
    setProjected(next);
  }, []);

  // Merge our event handler into the core's so a single `{...handlers}` spread wires
  // everything. Placement never sets emitProjections, so onProjection never fires there.
  const handlers = useMemo(() => ({ ...ar.handlers, onProjection }), [ar.handlers, onProjection]);

  // Place a point at screen center (the reticle). addAnchor raycasts + creates the
  // anchor and fires onAnchorsChange, which the hook folds into `anchors` → `result`.
  const addPointAtCenter = useCallback(() => {
    if (!ar.ready) return;
    ar.ref.current?.addAnchor(width / 2, height / 2).catch(() => {
      /* no surface at center — onError already fired */
    });
  }, [ar.ready, ar.ref, width, height]);

  // Place a point wherever the user tapped (wire to the view's onTap).
  const addPointAt = useCallback(
    (x: number, y: number) => {
      if (!ar.ready) return;
      ar.ref.current?.addAnchor(x, y).catch(() => {});
    },
    [ar.ready, ar.ref]
  );

  const undo = useCallback(() => {
    const last = ar.anchors[ar.anchors.length - 1];
    if (last) ar.ref.current?.removeAnchor(last.id).catch(() => {});
  }, [ar.anchors, ar.ref]);

  const clear = useCallback(() => {
    ar.reset();
  }, [ar]);

  return { ...ar, ...result, projected, handlers, addPointAtCenter, addPointAt, undo, clear };
}
