import type { ViewProps } from 'react-native';
import { z } from 'zod';

// ---- Enums ----
// Keep these enums byte-for-byte in sync with the native prop parsers and event
// emitters in ios/ExpoArModule.swift and android/.../ExpoArModule.kt. Drift here is
// the #1 "event never fires" bug.

export const TrackingState = z.enum(['initializing', 'limited', 'normal', 'unavailable']);
export type TrackingState = z.infer<typeof TrackingState>;

export const PlaneDetection = z.enum(['none', 'horizontal', 'vertical', 'both']);
export type PlaneDetection = z.infer<typeof PlaneDetection>;

export const RaycastTarget = z.enum(['plane', 'mesh', 'depth', 'feature']);
export type RaycastTarget = z.infer<typeof RaycastTarget>;

// ---- Core value types ----

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
  type: z.string(), // e.g. "plane" | "point" | feature-defined
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
export type ReadyEvent = z.infer<typeof ReadyEvent>;

export const TrackingStateEvent = z.object({ state: TrackingState });
export type TrackingStateEvent = z.infer<typeof TrackingStateEvent>;

export const TapEvent = z.object({ x: z.number(), y: z.number() });
export type TapEvent = z.infer<typeof TapEvent>;

export const AnchorsEvent = z.object({ anchors: z.array(Anchor) });
export type AnchorsEvent = z.infer<typeof AnchorsEvent>;

export const ErrorEvent = z.object({ code: z.string(), message: z.string() });
export type ErrorEvent = z.infer<typeof ErrorEvent>;

// ---- View props (JS -> native) + event handlers (native -> JS) ----

type NativeEvent<T> = { nativeEvent: T };

export interface ExpoArViewProps extends ViewProps {
  planeDetection?: PlaneDetection;
  depthEnabled?: boolean;
  debug?: boolean;
  onReady?: (e: NativeEvent<ReadyEvent>) => void;
  onTrackingStateChange?: (e: NativeEvent<TrackingStateEvent>) => void;
  onTap?: (e: NativeEvent<TapEvent>) => void;
  onAnchorsChange?: (e: NativeEvent<AnchorsEvent>) => void;
  onError?: (e: NativeEvent<ErrorEvent>) => void;
}

// ---- Imperative view handle (JS -> native, via the view ref) ----

export interface ArViewHandle {
  raycast(x: number, y: number): Promise<RaycastResult>;
  addAnchor(x: number, y: number): Promise<{ id: string } | null>;
  removeAnchor(id: string): Promise<void>;
  listAnchors(): Promise<Anchor[]>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(): Promise<void>;
  snapshot(): Promise<string>; // base64 JPEG
}
