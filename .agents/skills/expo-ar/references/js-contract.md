# JS Contract — the generic AR core (types, view, hook, overlays)

Canonical contract for the use-case-agnostic core. Swift and Kotlin must emit exactly these event names and payload keys. Feature-specific contracts (measurement points, placed models) extend this — see `examples/`.

## Table of contents
1. Core types & Zod schemas (`types.ts`)
2. Transform / pose helpers (`transform.ts`)
3. Native view wrapper (`ExpoArView.tsx`) + module entry (`index.ts`)
4. The `useArSession` hook
5. Overlay models (event-driven RN vs per-frame Skia)
6. Extending the contract for a feature

---

## 1. Core types & Zod schemas — `types.ts`

Zod validates payloads at the JS boundary, so a renamed key from Swift/Kotlin fails loudly instead of producing `undefined`. Keep the enums in sync with the native prop parsers.

```typescript
import { z } from 'zod';

export const TrackingState = z.enum(['initializing', 'limited', 'normal', 'unavailable']);
export type TrackingState = z.infer<typeof TrackingState>;

export const PlaneDetection = z.enum(['none', 'horizontal', 'vertical', 'both']);
export type PlaneDetection = z.infer<typeof PlaneDetection>;

export const RaycastTarget = z.enum(['plane', 'mesh', 'depth', 'feature']);

// 4x4 transform, column-major, 16 numbers — identical layout on both platforms. Meters.
export const Transform = z.array(z.number()).length(16);
export type Transform = z.infer<typeof Transform>;

export const Capabilities = z.object({
  arSupported: z.boolean(),
  depthOrLidarAvailable: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const Anchor = z.object({
  id: z.string(),
  transform: Transform,
  type: z.string(),            // e.g. "plane" | "point" | feature-defined
});
export type Anchor = z.infer<typeof Anchor>;

// ---- Function results (native -> JS, returned from AsyncFunctions) ----
export const RaycastResult = z.object({
  worldTransform: Transform.nullable(),
  target: RaycastTarget.nullable(),
});
export type RaycastResult = z.infer<typeof RaycastResult>;

// ---- Event payloads (native -> JS) ----
export const ReadyEvent = z.object({ capabilities: Capabilities });
export const TrackingStateEvent = z.object({ state: TrackingState });
export const TapEvent = z.object({ x: z.number(), y: z.number() });
export const AnchorsEvent = z.object({ anchors: z.array(Anchor) });
export const ErrorEvent = z.object({ code: z.string(), message: z.string() });
```

---

## 2. Transform / pose helpers — `transform.ts`

A 16-number column-major transform is the common currency. These helpers let the shared TS layer treat ARKit and ARCore poses uniformly.

```typescript
import type { Transform } from './types';

export type Vec3 = { x: number; y: number; z: number };

/** Translation (world position, meters) from a column-major 4x4. */
export const positionOf = (t: Transform): Vec3 => ({ x: t[12], y: t[13], z: t[14] });

/** Distance in meters between two transforms' positions. */
export const distanceBetween = (a: Transform, b: Transform): number => {
  const pa = positionOf(a), pb = positionOf(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
};
```

---

## 3. Native view wrapper — `ExpoArView.tsx` + `index.ts`

`requireNativeViewManager` returns the native component the module registers via `View(...)`; imperative methods are exposed on a ref.

```tsx
import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import type { ViewProps } from 'react-native';
import type { PlaneDetection, RaycastResult, Anchor } from './types';

type NativeEvent<T> = { nativeEvent: T };

export interface ExpoArViewProps extends ViewProps {
  planeDetection?: PlaneDetection;
  depthEnabled?: boolean;
  debug?: boolean;
  onReady?: (e: NativeEvent<unknown>) => void;
  onTrackingStateChange?: (e: NativeEvent<unknown>) => void;
  onTap?: (e: NativeEvent<unknown>) => void;
  onAnchorsChange?: (e: NativeEvent<unknown>) => void;
  onError?: (e: NativeEvent<unknown>) => void;
}

export interface ArViewHandle {
  raycast(x: number, y: number): Promise<RaycastResult>;
  addAnchor(x: number, y: number): Promise<{ id: string } | null>;
  removeAnchor(id: string): Promise<void>;
  listAnchors(): Promise<Anchor[]>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(): Promise<void>;
  snapshot(): Promise<string>; // base64
}

const NativeView: React.ComponentType<ExpoArViewProps & { ref?: React.Ref<any> }> =
  requireNativeViewManager('ExpoAr');

export const ExpoArView = React.forwardRef<ArViewHandle, ExpoArViewProps>(
  (props, ref) => <NativeView {...props} ref={ref as any} />
);
```

```typescript
// index.ts — module-level (no-view) functions + re-exports
import { requireNativeModule } from 'expo-modules-core';
import { Capabilities } from './types';
const native = requireNativeModule('ExpoAr');
export const getCapabilities = () => Capabilities.parse(native.getCapabilities());
export * from './types';
export * from './transform';
export { ExpoArView } from './ExpoArView';
export type { ArViewHandle, ExpoArViewProps } from './ExpoArView';
```

---

## 4. The `useArSession` hook

Owns generic session state and validates every payload with Zod, so native bugs surface as thrown parse errors in dev rather than silent `undefined`s. Feature hooks build on this.

```tsx
import { useCallback, useRef, useState } from 'react';
import type { ArViewHandle } from './ExpoArView';
import {
  ReadyEvent, TrackingStateEvent, AnchorsEvent, ErrorEvent,
  type TrackingState, type Capabilities, type Anchor,
} from './types';

export function useArSession() {
  const ref = useRef<ArViewHandle>(null);
  const [tracking, setTracking] = useState<TrackingState>('initializing');
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onReady = useCallback((e: { nativeEvent: unknown }) =>
    setCaps(ReadyEvent.parse(e.nativeEvent).capabilities), []);
  const onTrackingStateChange = useCallback((e: { nativeEvent: unknown }) =>
    setTracking(TrackingStateEvent.parse(e.nativeEvent).state), []);
  const onAnchorsChange = useCallback((e: { nativeEvent: unknown }) =>
    setAnchors(AnchorsEvent.parse(e.nativeEvent).anchors), []);
  const onError = useCallback((e: { nativeEvent: unknown }) =>
    setError(ErrorEvent.parse(e.nativeEvent).message), []);

  const ready = tracking === 'normal';

  return {
    ref, tracking, ready, caps, anchors, error,
    pause: () => ref.current?.pause(),
    resume: () => ref.current?.resume(),
    reset: () => ref.current?.reset(),
    handlers: { onReady, onTrackingStateChange, onAnchorsChange, onError },
  };
}
```

Wire it once, then build features by calling `ref.current?.raycast(...)` / `addAnchor(...)` and reacting to `anchors`:

```tsx
import { View } from 'react-native';
import { useEffect, useState } from 'react';
import { ExpoArView, getCapabilities, type Capabilities } from './index';
import { useArSession } from './useArSession';

export function ArRoot({ children }: { children?: React.ReactNode }) {
  const ar = useArSession();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => { setCaps(getCapabilities()); }, []);

  if (caps && !caps.arSupported) return <View style={{ flex: 1 }} />; /* expo-camera fallback */

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <ExpoArView
        ref={ar.ref}
        style={{ flex: 1 }}
        planeDetection="both"
        depthEnabled
        onReady={ar.handlers.onReady}
        onTrackingStateChange={ar.handlers.onTrackingStateChange}
        onAnchorsChange={ar.handlers.onAnchorsChange}
        onError={ar.handlers.onError}
      />
      {children /* 2D HUD overlay */}
    </View>
  );
}
```

Pause/resume on screen focus (React Navigation `useFocusEffect`, or `AppState`) to avoid the lifecycle crashes called out in SKILL.md:

```tsx
useFocusEffect(useCallback(() => { ar.resume(); return () => ar.pause(); }, []));
```

---

## 5. Overlay models

- **World-anchored 3D content** is rendered natively by the view; JS only sends commands (`addAnchor`, feature functions). Don't try to draw it from JS.
- **2D screen-space HUD** is RN over the view. Event-driven HUD → RN state is fine. **Per-frame** HUD (e.g. detection boxes at 30–60 fps) → draw on a `@shopify/react-native-skia` `Canvas`; re-rendering RN `<View>`s every frame is janky. Map any native screen coords through the same rotation/scale you'd use for camera frames.

A minimal neon/glass HUD pill + reticle (event-driven) is shown in `examples/measurement.md`; reuse its styles for any readout.

---

## 6. Extending the contract for a feature

Add feature props/events/functions *alongside* the core ones — never repurpose core names. Pattern:

1. Add a feature Zod schema (e.g. `MeasurementEvent`, `PlacedModelEvent`) to a feature `types` file.
2. Add the native `Prop`/`Event`/`AsyncFunction` on the same view in Swift and Kotlin (identical names).
3. Add a feature hook that wraps `useArSession` and layers feature state.

The examples do exactly this: measurement adds `mode`, `onMeasurementChange`, and point math; placement adds `modelUri`, `onModelPlaced`, and a `place(x,y)` function. The core (session, raycast, anchors, lifecycle) is untouched and shared.
