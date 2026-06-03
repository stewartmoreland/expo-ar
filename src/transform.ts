import type { Transform } from './ExpoAr.types';

// A 16-number column-major 4x4 transform is the common currency across ARKit and
// ARCore. These helpers let the shared TS layer treat poses from both platforms
// uniformly. All values are in meters.

export type Vec3 = { x: number; y: number; z: number };

/** Translation (world position, meters) from a column-major 4x4. */
export const positionOf = (t: Transform): Vec3 => ({ x: t[12], y: t[13], z: t[14] });

/** Distance in meters between two transforms' positions. */
export const distanceBetween = (a: Transform, b: Transform): number => {
  const pa = positionOf(a);
  const pb = positionOf(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
};
