import { z } from 'zod';
// TYPE-ONLY import → erased at compile time, so this module has NO runtime dependency
// on the 'expo-ar' barrel (which would pull in the native module). That keeps the pure
// math jest-testable without a native runtime. See features/__tests__/measurement.test.ts.
import type { Anchor } from 'expo-ar';

// All AR math is in METERS; convert to display units only at the UI edge (formatX).
// A local Vec3 + positionOf keeps this file runtime-clean (no 'expo-ar' value import).
// This mirrors the exported positionOf in src/transform.ts — the core's transform layout
// (column-major 4x4, translation at indices 12/13/14) is the contract both sides honor.
type Vec3 = { x: number; y: number; z: number };
const positionOf = (t: number[]): Vec3 => ({ x: t[12], y: t[13], z: t[14] });

export const Unit = z.enum(['m', 'cm', 'ft', 'in']);
export type Unit = z.infer<typeof Unit>;

export const MeasureMode = z.enum(['distance', 'area']);
export type MeasureMode = z.infer<typeof MeasureMode>;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

/** Straight-line distance (meters) between two world points. */
export const distance = (a: Vec3, b: Vec3): number => norm(sub(a, b));

/** Total path length (meters). `closed` adds the segment back to the first point. */
export const perimeter = (pts: Vec3[], closed = true): number => {
  if (pts.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += distance(pts[i], pts[i + 1]);
  // Only close polygons (3+ points); a 2-point "polygon" must not double back.
  if (closed && pts.length > 2) total += distance(pts[pts.length - 1], pts[0]);
  return total;
};

/**
 * Vector-area of a planar polygon in 3D (square meters) — robust on ANY plane (floor,
 * tilted table, wall), which is why measurement works regardless of surface orientation.
 */
export const area = (pts: Vec3[]): number => {
  if (pts.length < 3) return 0;
  const c = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
  c.x /= pts.length;
  c.y /= pts.length;
  c.z /= pts.length;
  let s: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < pts.length; i++) {
    const x = cross(sub(pts[i], c), sub(pts[(i + 1) % pts.length], c));
    s = { x: s.x + x.x, y: s.y + x.y, z: s.z + x.z };
  }
  return norm(s) / 2;
};

// Meters → display unit. cm/in get 1 decimal (they're already large numbers), m/ft get 2.
const M_TO: Record<Unit, number> = { m: 1, cm: 100, ft: 3.280839895, in: 39.37007874 };
const decimals = (u: Unit): number => (u === 'cm' || u === 'in' ? 1 : 2);

export const formatLength = (m: number | null, u: Unit): string =>
  m == null ? '—' : `${(m * M_TO[u]).toFixed(decimals(u))} ${u}`;

// Area converts with the SQUARE of the linear factor (1 m² = 10.764 ft²), and labels the
// unit squared. The unit param is genuinely used, so the readout honors the chosen unit.
export const formatArea = (m2: number | null, u: Unit): string =>
  m2 == null ? '—' : `${(m2 * M_TO[u] * M_TO[u]).toFixed(decimals(u))} ${u}²`;

/**
 * Pure derivation from the core's anchors — measurement holds NO AR state of its own.
 * `distance` is the last segment, `perimeter` the open path so far, `area` the polygon.
 */
export const measure = (anchors: Anchor[]) => {
  const points = anchors.map((a) => positionOf(a.transform));
  return {
    points,
    distance: points.length >= 2 ? distance(points[points.length - 2], points[points.length - 1]) : null,
    perimeter: points.length >= 2 ? perimeter(points, false) : null,
    area: points.length >= 3 ? area(points) : null,
  };
};
