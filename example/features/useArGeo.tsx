import {
  GeoStateEvent,
  useArSession,
  type GeoTrackingState,
  type GeospatialPose,
  type VpsAvailability,
} from 'expo-ar';
import { useCallback, useMemo, useState } from 'react';

import { canPlaceGeo, offsetLatLng } from './geospatial';

// Geospatial composes the SAME core session + anchors as measurement/placement, plus the geo
// primitives (trackingMode="geo", onGeoStateChange, addGeoAnchor). A geo anchor still flows
// through the core's onAnchorsChange (type "geo"); only the placement *source* (a real
// lat/long instead of a screen tap) and the localization gating are new — no new session code.
export function useArGeo() {
  const ar = useArSession();
  const [geoState, setGeoState] = useState<GeoTrackingState>('initializing');
  const [pose, setPose] = useState<GeospatialPose | null>(null);

  // Validate every native geo payload with Zod, exactly like the core handlers — a renamed
  // native key surfaces as a thrown parse error in dev rather than a silent undefined.
  const onGeoStateChange = useCallback((e: { nativeEvent: unknown }) => {
    const g = GeoStateEvent.parse(e.nativeEvent);
    setGeoState(g.state);
    setPose(g.pose);
  }, []);

  // Only place once localized AND accuracy is within thresholds (see geospatial.canPlaceGeo).
  const canPlace = useMemo(() => canPlaceGeo(geoState, pose), [geoState, pose]);

  // Drop a geo anchor ~2 m north of the device's current position. Reads the live pose so the
  // anchor lands at a real coordinate, not a screen point.
  const dropAnchorHere = useCallback(async () => {
    if (!canPlace) return;
    const current = (await ar.ref.current?.getGeospatialPose?.()) ?? pose;
    if (!current) return;
    const { latitude, longitude } = offsetLatLng(current.latitude, current.longitude, 2, 0);
    await ar.ref.current?.addGeoAnchor?.({
      latitude,
      longitude,
      altitude: current.altitude,
      heading: 0,
    });
  }, [ar.ref, canPlace, pose]);

  // Always check VPS coverage before offering geo placement — capability is not coverage.
  const checkVps = useCallback(
    (latitude: number, longitude: number): Promise<VpsAvailability | undefined> =>
      ar.ref.current?.checkVpsAvailability?.(latitude, longitude) ?? Promise.resolve(undefined),
    [ar.ref]
  );

  const clear = useCallback(() => ar.reset(), [ar]);

  return {
    ...ar,
    geoState,
    pose,
    canPlace,
    dropAnchorHere,
    checkVps,
    clear,
    geoCount: ar.anchors.length,
    handlers: { ...ar.handlers, onGeoStateChange },
  };
}
