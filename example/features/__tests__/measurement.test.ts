import type { Anchor } from 'expo-ar';

import {
  area,
  distance,
  formatArea,
  formatLength,
  measure,
  perimeter,
  segments,
} from '../measurement';

type Vec3 = { x: number; y: number; z: number };
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// A core anchor whose column-major transform carries the position at indices 12/13/14.
const anchorAt = (id: string, x: number, y: number, z: number): Anchor => {
  const transform = new Array(16).fill(0);
  transform[12] = x;
  transform[13] = y;
  transform[14] = z;
  return { id, transform, type: 'point' };
};

describe('distance', () => {
  it('computes the 3-4-5 right triangle hypotenuse', () => {
    expect(distance(v(0, 0, 0), v(3, 4, 0))).toBe(5);
  });

  it('is zero for a point and itself', () => {
    expect(distance(v(1, 2, 3), v(1, 2, 3))).toBe(0);
  });

  it('handles a non-axis-aligned vector', () => {
    expect(distance(v(0, 0, 0), v(1, 2, 2))).toBe(3);
  });
});

describe('segments', () => {
  it('is empty with fewer than 2 points', () => {
    expect(segments([])).toEqual([]);
    expect(segments([v(0, 0, 0)])).toEqual([]);
  });

  it('returns n-1 per-edge lengths for the open path', () => {
    // 3-4-5 triangle as an open chain: edges 3, then 5 (from (3,0,0) to (0,4,0))
    expect(segments([v(0, 0, 0), v(3, 0, 0), v(0, 4, 0)])).toEqual([3, 5]);
  });

  it('returns unit lengths for collinear unit-spaced points', () => {
    expect(segments([v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)])).toEqual([1, 1]);
  });
});

describe('perimeter', () => {
  it('is zero with fewer than 2 points', () => {
    expect(perimeter([])).toBe(0);
    expect(perimeter([v(0, 0, 0)])).toBe(0);
  });

  it('sums segments of an open chain', () => {
    // collinear unit-spaced points, open
    expect(perimeter([v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)], false)).toBe(2);
  });

  it('closes a triangle (3,4,5) when closed=true', () => {
    expect(perimeter([v(0, 0, 0), v(3, 0, 0), v(0, 4, 0)], true)).toBe(12);
  });

  it('does NOT double back with exactly 2 points even when closed', () => {
    expect(perimeter([v(0, 0, 0), v(3, 4, 0)], true)).toBe(5);
  });
});

describe('area', () => {
  it('is zero with fewer than 3 points', () => {
    expect(area([])).toBe(0);
    expect(area([v(0, 0, 0)])).toBe(0);
    expect(area([v(0, 0, 0), v(1, 0, 0)])).toBe(0);
  });

  it('measures a unit square on the floor (XZ plane)', () => {
    expect(area([v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)])).toBeCloseTo(1, 6);
  });

  it('measures a unit square on a tilted/vertical plane (XY) — plane-agnostic', () => {
    expect(area([v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)])).toBeCloseTo(1, 6);
  });

  it('measures a right triangle with legs 3 and 4', () => {
    expect(area([v(0, 0, 0), v(3, 0, 0), v(0, 4, 0)])).toBeCloseTo(6, 6);
  });
});

describe('formatLength', () => {
  it('renders an em dash for null', () => {
    expect(formatLength(null, 'm')).toBe('—');
  });

  it('formats meters with 2 decimals', () => {
    expect(formatLength(1, 'm')).toBe('1.00 m');
    expect(formatLength(0.5, 'm')).toBe('0.50 m');
  });

  it('converts and formats cm/ft/in (1 dp for cm/in, 2 dp for ft)', () => {
    expect(formatLength(1, 'cm')).toBe('100.0 cm');
    expect(formatLength(1, 'ft')).toBe('3.28 ft');
    expect(formatLength(1, 'in')).toBe('39.4 in');
  });
});

describe('formatArea', () => {
  it('renders an em dash for null', () => {
    expect(formatArea(null, 'm')).toBe('—');
  });

  it('formats square meters', () => {
    expect(formatArea(2.5, 'm')).toBe('2.50 m²');
  });

  it('converts area with the square of the linear factor', () => {
    expect(formatArea(1, 'ft')).toBe('10.76 ft²');
    expect(formatArea(1, 'cm')).toBe('10000.0 cm²');
  });
});

describe('measure (derivation from core anchors)', () => {
  it('returns all-null for an empty anchor list', () => {
    expect(measure([])).toEqual({
      points: [],
      segments: [],
      distance: null,
      perimeter: null,
      area: null,
    });
  });

  it('is all-null with a single anchor', () => {
    const r = measure([anchorAt('a', 0, 0, 0)]);
    expect(r.distance).toBeNull();
    expect(r.perimeter).toBeNull();
    expect(r.area).toBeNull();
  });

  it('derives distance from the last segment with 2 anchors (area still null)', () => {
    const r = measure([anchorAt('a', 0, 0, 0), anchorAt('b', 3, 4, 0)]);
    expect(r.distance).toBe(5);
    expect(r.perimeter).toBe(5);
    expect(r.segments).toEqual([5]);
    expect(r.area).toBeNull();
    expect(r.points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
    ]);
  });

  it('derives area and per-segment lengths with 3+ anchors', () => {
    const r = measure([anchorAt('a', 0, 0, 0), anchorAt('b', 3, 0, 0), anchorAt('c', 0, 4, 0)]);
    expect(r.area).toBeCloseTo(6, 6);
    expect(r.segments).toEqual([3, 5]);
    // distance tracks the LAST segment (b→c), not the whole path
    expect(r.distance).toBe(5);
  });
});
