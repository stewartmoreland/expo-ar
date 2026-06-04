import {
  Anchor,
  AnchorsEvent,
  Capabilities,
  ErrorEvent,
  ProjectedPoint,
  ProjectionEvent,
  RaycastResult,
  ReadyEvent,
  TapEvent,
  TrackingStateEvent,
  Transform,
} from '../ExpoAr.types';
import { distanceBetween, positionOf } from '../transform';

// A column-major 4x4 identity with translation (1, 2, 3) in the last column.
const identityAt = (x: number, y: number, z: number): number[] => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
];

describe('Transform', () => {
  it('accepts exactly 16 numbers', () => {
    expect(Transform.safeParse(new Array(16).fill(0)).success).toBe(true);
  });

  it('rejects arrays that are not length 16', () => {
    expect(Transform.safeParse(new Array(15).fill(0)).success).toBe(false);
    expect(Transform.safeParse(new Array(17).fill(0)).success).toBe(false);
  });
});

describe('transform helpers', () => {
  it('positionOf reads translation from indices 12/13/14', () => {
    expect(positionOf(identityAt(1, 2, 3))).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('distanceBetween computes euclidean distance in meters', () => {
    expect(distanceBetween(identityAt(0, 0, 0), identityAt(3, 4, 0))).toBe(5);
  });
});

describe('event payload schemas (round-trip)', () => {
  it('ReadyEvent parses a valid payload and rejects a renamed key', () => {
    const payload = { capabilities: { arSupported: true, depthOrLidarAvailable: false } };
    expect(ReadyEvent.parse(payload)).toEqual(payload);
    expect(() => ReadyEvent.parse({ capability: payload.capabilities })).toThrow();
  });

  it('TrackingStateEvent parses valid states and rejects unknown ones', () => {
    expect(TrackingStateEvent.parse({ state: 'normal' })).toEqual({ state: 'normal' });
    expect(() => TrackingStateEvent.parse({ state: 'tracking' })).toThrow();
    expect(() => TrackingStateEvent.parse({ statee: 'normal' })).toThrow();
  });

  it('TapEvent round-trips', () => {
    expect(TapEvent.parse({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it('AnchorsEvent round-trips a list of anchors', () => {
    const payload = {
      anchors: [{ id: 'a1', transform: identityAt(1, 0, 0), type: 'plane' }],
    };
    expect(AnchorsEvent.parse(payload)).toEqual(payload);
  });

  it('ErrorEvent round-trips', () => {
    const payload = { code: 'E_TRACKING_LOST', message: 'lost tracking' };
    expect(ErrorEvent.parse(payload)).toEqual(payload);
  });

  it('ProjectedPoint round-trips and rejects a renamed key', () => {
    const payload = { id: 'a1', x: 120.5, y: 240, inFront: true };
    expect(ProjectedPoint.parse(payload)).toEqual(payload);
    // `inFront` is the parity tripwire — Swift/Kotlin must emit this exact key.
    expect(() => ProjectedPoint.parse({ id: 'a1', x: 1, y: 2, infront: true })).toThrow();
  });

  it('ProjectionEvent round-trips a list of projected points', () => {
    const payload = {
      points: [
        { id: 'a1', x: 10, y: 20, inFront: true },
        { id: 'a2', x: 30, y: 40, inFront: false },
      ],
    };
    expect(ProjectionEvent.parse(payload)).toEqual(payload);
    expect(ProjectionEvent.parse({ points: [] })).toEqual({ points: [] });
  });
});

describe('Anchor / Capabilities / RaycastResult', () => {
  it('Anchor requires a length-16 transform', () => {
    expect(
      Anchor.safeParse({ id: 'a', transform: identityAt(0, 0, 0), type: 'point' }).success
    ).toBe(true);
    expect(Anchor.safeParse({ id: 'a', transform: [0, 0, 0], type: 'point' }).success).toBe(false);
  });

  it('Capabilities round-trips', () => {
    const payload = { arSupported: true, depthOrLidarAvailable: true };
    expect(Capabilities.parse(payload)).toEqual(payload);
  });

  it('RaycastResult accepts a hit and a null miss', () => {
    expect(
      RaycastResult.parse({ worldTransform: identityAt(0, 0, 0), target: 'plane' })
    ).toBeTruthy();
    expect(RaycastResult.parse({ worldTransform: null, target: null })).toEqual({
      worldTransform: null,
      target: null,
    });
  });
});
