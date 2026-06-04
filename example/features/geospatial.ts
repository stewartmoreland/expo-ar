import { z } from 'zod';
// TYPE-ONLY import (erased at compile) → this module stays runtime-clean and jest-testable
// without the native module. See features/__tests__/geospatial.test.ts.
import type { GeoTrackingState, GeospatialPose } from 'expo-ar';

// Placement thresholds. A "localized" session can still report multi-meter horizontal and
// large heading error; placing then puts content visibly off. Hold until accuracy is within
// these bounds (tune per use case). iOS accuracy is approximate — see the contract notes.
export const GeoThresholds = z.object({
  horizontalAccuracy: z.number().default(1.5), // meters
  headingAccuracy: z.number().default(15), // degrees
});
export type GeoThresholds = z.infer<typeof GeoThresholds>;

export const DEFAULT_GEO_THRESHOLDS: GeoThresholds = {
  horizontalAccuracy: 1.5,
  headingAccuracy: 15,
};

/**
 * Whether it's safe to drop a geo anchor now: localized AND pose accuracy within thresholds.
 * Pure — holds no AR state, so it's unit-testable without a device.
 */
export function canPlaceGeo(
  state: GeoTrackingState,
  pose: GeospatialPose | null,
  thresholds: GeoThresholds = DEFAULT_GEO_THRESHOLDS
): boolean {
  if (state !== 'localized' || !pose) return false;
  return (
    pose.horizontalAccuracy <= thresholds.horizontalAccuracy &&
    pose.headingAccuracy <= thresholds.headingAccuracy
  );
}

const EARTH_RADIUS_M = 6_378_137; // WGS84 equatorial radius

/**
 * Offset a lat/long by meters north/east (small-distance equirectangular approximation —
 * sub-meter accurate at city scale). Used to drop an anchor a few meters from the device
 * rather than exactly underfoot. Pure.
 */
export function offsetLatLng(
  latitude: number,
  longitude: number,
  metersNorth: number,
  metersEast: number
): { latitude: number; longitude: number } {
  const dLat = (metersNorth / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng =
    (metersEast / (EARTH_RADIUS_M * Math.cos((latitude * Math.PI) / 180))) * (180 / Math.PI);
  return { latitude: latitude + dLat, longitude: longitude + dLng };
}

/** "±1.5 m" horizontal accuracy, or "—" with no pose. */
export function formatAccuracy(pose: GeospatialPose | null): string {
  if (!pose) return '—';
  return `±${pose.horizontalAccuracy.toFixed(1)} m`;
}

/** Human label for the geo-tracking state. */
export function formatGeoState(state: GeoTrackingState): string {
  switch (state) {
    case 'localized':
      return 'Localized';
    case 'localizing':
      return 'Localizing…';
    case 'initializing':
      return 'Initializing…';
    case 'unavailable':
      return 'Unavailable';
  }
}
