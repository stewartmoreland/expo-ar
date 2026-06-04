import type { GeospatialPose } from 'expo-ar';

import {
  DEFAULT_GEO_THRESHOLDS,
  canPlaceGeo,
  formatAccuracy,
  formatGeoState,
  offsetLatLng,
} from '../geospatial';

const pose = (overrides: Partial<GeospatialPose> = {}): GeospatialPose => ({
  latitude: 37.422,
  longitude: -122.084,
  altitude: 10,
  horizontalAccuracy: 1.0,
  verticalAccuracy: 1.5,
  headingAccuracy: 8,
  ...overrides,
});

describe('canPlaceGeo', () => {
  it('is false when not localized, regardless of accuracy', () => {
    expect(canPlaceGeo('localizing', pose())).toBe(false);
    expect(canPlaceGeo('initializing', pose())).toBe(false);
    expect(canPlaceGeo('unavailable', pose())).toBe(false);
  });

  it('is false when localized but pose is missing', () => {
    expect(canPlaceGeo('localized', null)).toBe(false);
  });

  it('is true when localized and accuracy is within the default thresholds', () => {
    expect(canPlaceGeo('localized', pose())).toBe(true);
  });

  it('gates on horizontal accuracy', () => {
    expect(canPlaceGeo('localized', pose({ horizontalAccuracy: 5 }))).toBe(false);
    expect(canPlaceGeo('localized', pose({ horizontalAccuracy: DEFAULT_GEO_THRESHOLDS.horizontalAccuracy }))).toBe(true);
  });

  it('gates on heading accuracy', () => {
    expect(canPlaceGeo('localized', pose({ headingAccuracy: 30 }))).toBe(false);
    expect(canPlaceGeo('localized', pose({ headingAccuracy: DEFAULT_GEO_THRESHOLDS.headingAccuracy }))).toBe(true);
  });

  it('honors custom thresholds', () => {
    const lenient = { horizontalAccuracy: 10, headingAccuracy: 45 };
    expect(canPlaceGeo('localized', pose({ horizontalAccuracy: 8, headingAccuracy: 40 }), lenient)).toBe(true);
  });
});

describe('offsetLatLng', () => {
  it('returns the same point for a zero offset', () => {
    const r = offsetLatLng(37, -122, 0, 0);
    expect(r.latitude).toBeCloseTo(37, 9);
    expect(r.longitude).toBeCloseTo(-122, 9);
  });

  it('moving north increases latitude by ~1e-5 deg per ~1.1 m', () => {
    // 111 m north ≈ 0.001 deg latitude.
    const r = offsetLatLng(0, 0, 111, 0);
    expect(r.latitude).toBeCloseTo(0.000997, 5);
    expect(r.longitude).toBeCloseTo(0, 9);
  });

  it('moving east scales longitude by 1/cos(latitude)', () => {
    // At the equator, equal meters east ≈ equal degrees as north; at 60° lat, doubled.
    const eq = offsetLatLng(0, 0, 0, 111);
    const hi = offsetLatLng(60, 0, 0, 111);
    expect(hi.longitude).toBeCloseTo(eq.longitude * 2, 4);
  });
});

describe('formatAccuracy', () => {
  it('renders a dash with no pose', () => {
    expect(formatAccuracy(null)).toBe('—');
  });

  it('renders one decimal of horizontal accuracy in meters', () => {
    expect(formatAccuracy(pose({ horizontalAccuracy: 2.34 }))).toBe('±2.3 m');
  });
});

describe('formatGeoState', () => {
  it('maps each state to a human label', () => {
    expect(formatGeoState('localized')).toBe('Localized');
    expect(formatGeoState('localizing')).toBe('Localizing…');
    expect(formatGeoState('initializing')).toBe('Initializing…');
    expect(formatGeoState('unavailable')).toBe('Unavailable');
  });
});
