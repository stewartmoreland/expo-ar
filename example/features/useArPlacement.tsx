import { useArSession } from 'expo-ar';
import { useCallback, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { toPlacedModels } from './placement';

// Default "model": the native side renders a built-in primitive for any URI it can't
// load as a real glTF/USDZ, so the demo is self-contained. Pass a real model URI to
// exercise the native asset-loading branch.
export const DEFAULT_MODEL_URI = 'builtin:cube';

// Placement composes the SAME core primitives as measurement (addAnchor +
// onAnchorsChange + reset) but turns anchors into models instead of numbers. The model
// lifecycle lives entirely in JS — the core's removeAnchor/reset never know models
// exist; we detach the native node BEFORE removing the anchor. No new session code.
export function useArPlacement(defaultModelUri: string = DEFAULT_MODEL_URI) {
  const ar = useArSession();
  const { width, height } = useWindowDimensions();
  // anchorId → which model is on it. Reactive state so `placed` recomputes on change.
  const [byId, setById] = useState<Record<string, { uri: string; scale: number }>>({});

  const placeAt = useCallback(
    async (x: number, y: number, uri: string = defaultModelUri) => {
      if (!ar.ready) return;
      const res = await ar.ref.current?.addAnchor(x, y).catch(() => null);
      if (res?.id) {
        await ar.ref.current?.attachModel?.(res.id, uri);
        setById((prev) => ({ ...prev, [res.id]: { uri, scale: 1 } }));
      }
    },
    [ar.ready, ar.ref, defaultModelUri]
  );

  // Place at screen center (the reticle) — for the HUD "Place" button.
  const placeAtCenter = useCallback(
    (uri: string = defaultModelUri) => placeAt(width / 2, height / 2, uri),
    [placeAt, width, height, defaultModelUri]
  );

  const remove = useCallback(
    async (id: string) => {
      // Detach the model node first, THEN remove the core anchor (order matters so we
      // never orphan a node whose anchor is already gone).
      await ar.ref.current?.detachModel?.(id);
      await ar.ref.current?.removeAnchor(id);
      setById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [ar.ref]
  );

  const removeLast = useCallback(() => {
    const last = ar.anchors[ar.anchors.length - 1];
    if (last) void remove(last.id);
  }, [ar.anchors, remove]);

  const clear = useCallback(async () => {
    // Detach every model node before the core clears its anchors in reset().
    await Promise.all(Object.keys(byId).map((id) => ar.ref.current?.detachModel?.(id)));
    setById({});
    await ar.reset();
  }, [ar, byId]);

  const placed = useMemo(() => toPlacedModels(ar.anchors, byId), [ar.anchors, byId]);

  return { ...ar, placeAt, placeAtCenter, remove, removeLast, clear, placed, placedCount: placed.length };
}
