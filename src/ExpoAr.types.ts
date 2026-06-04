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

// A world point projected to the screen. x/y are RN logical points/dp — the SAME
// coordinate space as onTap and the raycast/addAnchor inputs, so a JS overlay placed
// at (x, y) lands on the natively-rendered geometry on both platforms. `inFront` is
// false when the point is behind the camera (hide any label that depends on it).
export const ProjectedPoint = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  inFront: z.boolean(),
});
export type ProjectedPoint = z.infer<typeof ProjectedPoint>;

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

// Per-frame screen positions of the current anchors, emitted (throttled) only while the
// opt-in `emitProjections` prop is set. Lets a 2D HUD pin labels to world-anchored points
// that track as the device moves. High-frequency — consumers should read nativeEvent
// directly rather than Zod-parsing on every frame (see useArMeasure).
export const ProjectionEvent = z.object({ points: z.array(ProjectedPoint) });
export type ProjectionEvent = z.infer<typeof ProjectionEvent>;

// ---- View props (JS -> native) + event handlers (native -> JS) ----

type NativeEvent<T> = { nativeEvent: T };

export interface ExpoArViewProps extends ViewProps {
  planeDetection?: PlaneDetection;
  depthEnabled?: boolean;
  debug?: boolean;
  // Opt-in per-frame projection of anchors to screen space (drives object-pinned labels).
  // Off by default so non-measurement screens pay zero per-frame cost.
  emitProjections?: boolean;
  onReady?: (e: NativeEvent<ReadyEvent>) => void;
  onTrackingStateChange?: (e: NativeEvent<TrackingStateEvent>) => void;
  onTap?: (e: NativeEvent<TapEvent>) => void;
  onAnchorsChange?: (e: NativeEvent<AnchorsEvent>) => void;
  onProjection?: (e: NativeEvent<ProjectionEvent>) => void;
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

  // ---- Additive rendering primitives (used by the placement feature) ----
  // Optional because the web no-AR stub exposes none of the native functions, and any
  // non-rendering consumer (e.g. measurement) ignores them. These extend the generic
  // rendering surface only — they do not touch session/tracking/raycast/anchor logic,
  // so the core stays use-case-agnostic.
  attachModel?(anchorId: string, modelUri: string): Promise<void>;
  detachModel?(anchorId: string): Promise<void>;

  // One-shot world→screen projection (same coordinate space as ProjectedPoint). Optional
  // for the same reason as the rendering primitives — the web stub exposes none. For
  // continuous tracking prefer the `emitProjections` prop + onProjection event.
  worldToScreen?(transform: Transform): Promise<ProjectedPoint | null>;
}
