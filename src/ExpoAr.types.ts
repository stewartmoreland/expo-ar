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

// ---- Geospatial extension enums ----
// Geospatial anchoring places content at real lat/long/altitude. It's a core-level
// extension: it changes the session configuration (a tracking *mode*) rather than just
// composing the existing primitives. Keep these byte-for-byte in sync with the native sides.

// Selects the session configuration. "world" is the default local-space tracking; "geo"
// switches to ARKit ARGeoTrackingConfiguration / ARCore Geospatial (Earth API).
export const TrackingMode = z.enum(['world', 'geo']);
export type TrackingMode = z.infer<typeof TrackingMode>;

// Quality of the geospatial (VPS) localization. Only place geo anchors once `localized`
// AND the pose accuracy is within thresholds (see GeospatialPose / useArGeo).
export const GeoTrackingState = z.enum(['unavailable', 'initializing', 'localizing', 'localized']);
export type GeoTrackingState = z.infer<typeof GeoTrackingState>;

// Whether Visual Positioning System coverage exists at a coordinate (checkVpsAvailability).
export const VpsAvailability = z.enum(['available', 'unavailable', 'unknown']);
export type VpsAvailability = z.infer<typeof VpsAvailability>;

// ---- Core value types ----

// 4x4 transform, column-major, 16 numbers — identical layout on both platforms. Meters.
export const Transform = z.array(z.number()).length(16);
export type Transform = z.infer<typeof Transform>;

export const Capabilities = z.object({
  arSupported: z.boolean(),
  depthOrLidarAvailable: z.boolean(),
  // Whether geospatial/VPS tracking is available: ARGeoTrackingConfiguration.isSupported on
  // iOS, isGeospatialModeSupported(ENABLED) on Android. Independent of VPS *coverage* at a
  // given location — always checkVpsAvailability(lat,lng) before offering geo placement.
  geoTrackingSupported: z.boolean(),
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

// ---- Geospatial extension value types ----

// Device (or anchor) geospatial pose + its accuracy. Accuracy gates whether content placed
// now will land where intended — a "localized" session can still report multi-meter error.
// NOTE: Android reports exact meter/degree accuracies from cameraGeospatialPose; iOS derives
// lat/long/altitude from ARKit's getGeoLocation(forPoint:) and maps the coarse
// ARGeoTrackingStatus.accuracy to representative values — treat iOS accuracy as approximate.
export const GeospatialPose = z.object({
  latitude: z.number(),
  longitude: z.number(),
  altitude: z.number(), // meters, WGS84 ellipsoid
  horizontalAccuracy: z.number(), // meters
  verticalAccuracy: z.number(), // meters
  headingAccuracy: z.number(), // degrees (orientation/yaw accuracy)
});
export type GeospatialPose = z.infer<typeof GeospatialPose>;

// Input to addGeoAnchor. `altitude: null` anchors to terrain/ground level (resolved from VPS).
// `heading` is applied on Android (ARCore createAnchor orientation); iOS ignores it (ARGeoAnchor
// has no heading) — documented asymmetry, the signature stays identical across platforms.
export const GeoAnchorInput = z.object({
  latitude: z.number(),
  longitude: z.number(),
  altitude: z.number().nullable(),
  heading: z.number().default(0),
});
export type GeoAnchorInput = z.infer<typeof GeoAnchorInput>;

// onGeoStateChange payload — emitted on geo-tracking transitions and throttled pose updates.
// `pose` may be null before the first fix. Carries the accuracy fields the UI gates placement on.
export const GeoStateEvent = z.object({
  state: GeoTrackingState,
  pose: GeospatialPose.nullable(),
});
export type GeoStateEvent = z.infer<typeof GeoStateEvent>;

// ---- View props (JS -> native) + event handlers (native -> JS) ----

type NativeEvent<T> = { nativeEvent: T };

export interface ExpoArViewProps extends ViewProps {
  planeDetection?: PlaneDetection;
  depthEnabled?: boolean;
  debug?: boolean;
  // Opt-in per-frame projection of anchors to screen space (drives object-pinned labels).
  // Off by default so non-measurement screens pay zero per-frame cost.
  emitProjections?: boolean;
  // Geospatial extension: "world" (default) tracks local space; "geo" switches the session to
  // VPS-localized geospatial tracking. Changing it restarts the session (one config per session).
  trackingMode?: TrackingMode;
  onReady?: (e: NativeEvent<ReadyEvent>) => void;
  onTrackingStateChange?: (e: NativeEvent<TrackingStateEvent>) => void;
  onTap?: (e: NativeEvent<TapEvent>) => void;
  onAnchorsChange?: (e: NativeEvent<AnchorsEvent>) => void;
  onProjection?: (e: NativeEvent<ProjectionEvent>) => void;
  // Geospatial extension: geo-tracking state transitions + throttled pose/accuracy updates.
  // Only fires while trackingMode is "geo".
  onGeoStateChange?: (e: NativeEvent<GeoStateEvent>) => void;
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

  // ---- Geospatial extension primitives (active only while trackingMode is "geo") ----
  // Optional for the same reason as above — the web stub exposes none. These extend the
  // session with geo-anchoring; they don't change the local-space raycast/anchor core.

  // Is there VPS coverage at this coordinate? Always check before offering geo placement —
  // capability (geoTrackingSupported) is not the same as coverage at a location.
  checkVpsAvailability?(latitude: number, longitude: number): Promise<VpsAvailability>;
  // Create an anchor at a real lat/long(/altitude). Returns null (and emits onError) if the
  // session isn't localized. The new anchor flows through onAnchorsChange with type "geo".
  addGeoAnchor?(input: GeoAnchorInput): Promise<{ id: string } | null>;
  // The device's current geospatial pose, or null when not yet localized.
  getGeospatialPose?(): Promise<GeospatialPose | null>;
}
