import { useCallback, useReducer, useRef } from 'react';

import {
  AnchorsEvent,
  ErrorEvent,
  ReadyEvent,
  TrackingStateEvent,
  type Anchor,
  type ArViewHandle,
  type Capabilities,
  type TrackingState,
} from './ExpoAr.types';

// This file imports ONLY from './ExpoAr.types' (+ react) — never the native module —
// so it loads without a native runtime (e.g. under jest) and triggers no
// requireNativeView/requireNativeModule.

export type ArSessionState = {
  tracking: TrackingState;
  caps: Capabilities | null;
  anchors: Anchor[];
  error: string | null;
};

export type ArSessionAction =
  | { type: 'ready'; caps: Capabilities }
  | { type: 'tracking'; state: TrackingState }
  | { type: 'anchors'; anchors: Anchor[] }
  | { type: 'error'; message: string };

export const initialArSessionState: ArSessionState = {
  tracking: 'initializing',
  caps: null,
  anchors: [],
  error: null,
};

/** Pure state transition for the AR session — exported so it can be unit-tested without React. */
export function arSessionReducer(state: ArSessionState, action: ArSessionAction): ArSessionState {
  switch (action.type) {
    case 'ready':
      return { ...state, caps: action.caps };
    case 'tracking':
      return { ...state, tracking: action.state };
    case 'anchors':
      return { ...state, anchors: action.anchors };
    case 'error':
      return { ...state, error: action.message };
  }
}

/**
 * Owns generic AR session state and validates every native payload with Zod, so native
 * bugs (a renamed key) surface as thrown parse errors in dev rather than silent
 * `undefined`s. Feature hooks build on this. Wire `ref` to <ExpoArView/> and spread
 * `handlers` onto its event props.
 */
export function useArSession() {
  const ref = useRef<ArViewHandle>(null);
  const [state, dispatch] = useReducer(arSessionReducer, initialArSessionState);

  const onReady = useCallback(
    (e: { nativeEvent: unknown }) =>
      dispatch({ type: 'ready', caps: ReadyEvent.parse(e.nativeEvent).capabilities }),
    []
  );
  const onTrackingStateChange = useCallback(
    (e: { nativeEvent: unknown }) =>
      dispatch({ type: 'tracking', state: TrackingStateEvent.parse(e.nativeEvent).state }),
    []
  );
  const onAnchorsChange = useCallback(
    (e: { nativeEvent: unknown }) =>
      dispatch({ type: 'anchors', anchors: AnchorsEvent.parse(e.nativeEvent).anchors }),
    []
  );
  const onError = useCallback(
    (e: { nativeEvent: unknown }) =>
      dispatch({ type: 'error', message: ErrorEvent.parse(e.nativeEvent).message }),
    []
  );

  return {
    ref,
    tracking: state.tracking,
    ready: state.tracking === 'normal',
    caps: state.caps,
    anchors: state.anchors,
    error: state.error,
    pause: () => ref.current?.pause(),
    resume: () => ref.current?.resume(),
    reset: () => ref.current?.reset(),
    handlers: { onReady, onTrackingStateChange, onAnchorsChange, onError },
  };
}
