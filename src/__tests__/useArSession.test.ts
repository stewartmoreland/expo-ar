import { act, renderHook } from '@testing-library/react-native';

import { arSessionReducer, initialArSessionState, useArSession } from '../useArSession';

describe('arSessionReducer (pure)', () => {
  it('starts initializing with no caps/anchors/error', () => {
    expect(initialArSessionState).toEqual({
      tracking: 'initializing',
      caps: null,
      anchors: [],
      error: null,
    });
  });

  it('tracking action updates tracking state', () => {
    const next = arSessionReducer(initialArSessionState, { type: 'tracking', state: 'normal' });
    expect(next.tracking).toBe('normal');
  });

  it('ready action stores capabilities', () => {
    const caps = { arSupported: true, depthOrLidarAvailable: false };
    expect(arSessionReducer(initialArSessionState, { type: 'ready', caps }).caps).toEqual(caps);
  });

  it('anchors action replaces the anchor list', () => {
    const anchors = [{ id: 'a1', transform: new Array(16).fill(0), type: 'plane' }];
    expect(arSessionReducer(initialArSessionState, { type: 'anchors', anchors }).anchors).toEqual(
      anchors
    );
  });

  it('error action stores the message', () => {
    expect(arSessionReducer(initialArSessionState, { type: 'error', message: 'boom' }).error).toBe(
      'boom'
    );
  });
});

describe('useArSession (hook wiring)', () => {
  it('derives ready once tracking reaches normal via a mocked native event', () => {
    const { result } = renderHook(() => useArSession());
    expect(result.current.ready).toBe(false);

    act(() => {
      result.current.handlers.onTrackingStateChange({ nativeEvent: { state: 'normal' } });
    });
    expect(result.current.tracking).toBe('normal');
    expect(result.current.ready).toBe(true);
  });

  it('stores capabilities and anchors from mocked native events', () => {
    const { result } = renderHook(() => useArSession());

    act(() => {
      result.current.handlers.onReady({
        nativeEvent: { capabilities: { arSupported: true, depthOrLidarAvailable: true } },
      });
      result.current.handlers.onAnchorsChange({
        nativeEvent: { anchors: [{ id: 'a1', transform: new Array(16).fill(0), type: 'plane' }] },
      });
    });

    expect(result.current.caps).toEqual({ arSupported: true, depthOrLidarAvailable: true });
    expect(result.current.anchors).toHaveLength(1);
  });

  it('throws on a malformed native payload (Zod guards the boundary)', () => {
    const { result } = renderHook(() => useArSession());
    expect(() =>
      act(() => {
        result.current.handlers.onTrackingStateChange({ nativeEvent: { state: 'bogus' } });
      })
    ).toThrow();
  });
});
