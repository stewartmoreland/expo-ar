# Extension — geospatial / VPS anchoring (ARKit + ARCore)

Place anchors at real-world latitude/longitude/altitude so content stays fixed to a *place* across sessions and users (wayfinding arrows on a street, a sign over a building, a world-scale game). Unlike `measurement.md` and `object-placement.md`, this is a **core-level extension, not a pure feature** — it changes the session *configuration* and adds a tracking mode, so it lives next to the core, and the build/auth setup is heavier. Read `ios-arkit.md` / `android-arcore.md` first; this layers on them.

## Two paths — decide first

Geospatial is **not one API across platforms**. Pick before writing code:

- **Path A — native per platform.** ARKit's `ARGeoTrackingConfiguration` on iOS + ARCore's Geospatial (Earth) API on Android. No new iOS dependency; ARKit's path needs no cloud credentials. Cost: Apple's VPS only covers a limited set of cities, and you reconcile two different anchor APIs and availability stories.
- **Path B — Google Geospatial on both.** Run ARCore's Geospatial API on iOS too (via the ARCore SDK pod). One API, one coordinate system, Google Street View–scale coverage. Cost: a real new native dependency on iOS, and Google Cloud provisioning + auth (keyless tokens or API key) on both platforms — keyless implies a small token-signing server you run.

Rule of thumb: a few flagship cities and zero backend → A. World-scale coverage and a unified API → B. The **shared contract below is identical either way**; only the iOS implementation and the build/auth setup differ.

## Shared contract additions — `features/geospatial.ts`

These extend the core contract; they never repurpose core names.

```typescript
import { z } from 'zod';

export const GeoTrackingState = z.enum(['unavailable', 'initializing', 'localizing', 'localized']);
export type GeoTrackingState = z.infer<typeof GeoTrackingState>;

export const VpsAvailability = z.enum(['available', 'unavailable', 'unknown']);

// A geospatial pose + its accuracy. Accuracy gates whether you should place anchors yet.
export const GeospatialPose = z.object({
  latitude: z.number(),
  longitude: z.number(),
  altitude: z.number(),                 // meters, WGS84 ellipsoid
  horizontalAccuracy: z.number(),       // meters
  verticalAccuracy: z.number(),         // meters
  headingAccuracy: z.number(),          // degrees (orientation/yaw accuracy)
});
export type GeospatialPose = z.infer<typeof GeospatialPose>;

export const GeoAnchorInput = z.object({
  latitude: z.number(),
  longitude: z.number(),
  altitude: z.number().nullable(),      // null => anchor to terrain/ground level
  heading: z.number().default(0),       // degrees, optional orientation
});
export type GeoAnchorInput = z.infer<typeof GeoAnchorInput>;

// Events added to the view:
export const GeoStateEvent = z.object({ state: GeoTrackingState, pose: GeospatialPose.nullable() });
```

View-surface additions (Swift + Kotlin, identical names):
- **Prop:** `trackingMode` (`"world" | "geo"`) — selects the session configuration.
- **Async functions:** `checkVpsAvailability(lat, lng) → "available"|"unavailable"|"unknown"`, `addGeoAnchor(input: GeoAnchorInput) → { id } | null`, `getGeospatialPose() → GeospatialPose | null`.
- **Event:** `onGeoStateChange({ state, pose })` — emit on geo-tracking transitions and throttled pose updates; carries the accuracy fields the UI gates on.

Anchors still flow through the core's `onAnchorsChange`; a geo anchor is just an anchor whose `type` is `"geo"`. Rendering (a model/arrow on the anchor) is unchanged from `object-placement.md`.

## iOS — Path A (ARKit `ARGeoTrackingConfiguration`, no new dependency)

It's an `ARConfiguration` subclass on the same `ARSession` — pure ARKit, plus Core Location.

```swift
import ARKit
import CoreLocation

extension ExpoArView {
  func startGeoSession() {
    guard ARGeoTrackingConfiguration.isSupported else {
      onError(["code": "geo_unsupported", "message": "Geo tracking needs A12+ and GPS."]); return
    }
    // Requires NSLocationWhenInUseUsageDescription + an authorized CLLocationManager.
    let config = ARGeoTrackingConfiguration()
    config.planeDetection = [.horizontal]
    sceneView.session.run(config)   // delegate's didChange ARGeoTrackingStatus drives onGeoStateChange
  }

  func checkVps(_ lat: Double, _ lng: Double, _ resolve: @escaping (String) -> Void) {
    let coord = CLLocationCoordinate2D(latitude: lat, longitude: lng)
    ARGeoTrackingConfiguration.checkAvailability(at: coord) { available, _ in
      resolve(available ? "available" : "unavailable")
    }
  }

  func addGeoAnchor(_ lat: Double, _ lng: Double, _ alt: Double?) -> [String: Any]? {
    let coord = CLLocationCoordinate2D(latitude: lat, longitude: lng)
    let anchor = alt != nil ? ARGeoAnchor(coordinate: coord, altitude: alt!)
                            : ARGeoAnchor(coordinate: coord)   // ground level
    sceneView.session.add(anchor: anchor)
    anchorsById[anchor.identifier.uuidString] = anchor
    return ["id": anchor.identifier.uuidString]
  }
}

// ARGeoTrackingStatus -> contract state
func session(_ s: ARSession, didChange geoStatus: ARGeoTrackingStatus) {
  let state: String
  switch geoStatus.state {
  case .notAvailable: state = "unavailable"
  case .initializing: state = "initializing"
  case .localizing:   state = "localizing"
  case .localized:    state = "localized"
  @unknown default:   state = "unavailable"
  }
  onGeoStateChange(["state": state, "pose": NSNull()]) // attach pose via session.getGeoLocation(forPoint:) if needed
}
```

`session.getGeoLocation(forPoint:completionHandler:)` converts a tapped world point into lat/long/altitude — pair it with the core's `raycast` for "tap to drop a geo-anchor here."

## iOS — Path B (ARCore Geospatial on iOS)

Add the ARCore SDK pod (`pod 'ARCore/Geospatial'`) — this is the new native iOS dependency. You keep ARKit for tracking/rendering and feed its frames to a `GARSession`, which provides the geospatial transform and geo anchors. Authorize the `GARSession` with a keyless token or API key (same GCP project as Android). More moving parts than Path A; choose it only for the coverage/unification payoff.

## Android — ARCore Geospatial (Earth API)

```kotlin
import com.google.ar.core.*

// In configure(): enable geospatial only in geo mode.
if (trackingMode == "geo" && session.isGeospatialModeSupported(Config.GeospatialMode.ENABLED)) {
  config.geospatialMode = Config.GeospatialMode.ENABLED
}

fun checkVps(lat: Double, lng: Double, resolve: (String) -> Unit) {
  sceneView.session?.checkVpsAvailabilityAsync(lat, lng) { a ->
    resolve(if (a == VpsAvailability.AVAILABLE) "available" else "unavailable")
  }
}

fun getGeospatialPose(): Map<String, Any?>? {
  val earth = sceneView.session?.earth ?: return null
  if (earth.earthState != Earth.EarthState.ENABLED || earth.trackingState != TrackingState.TRACKING) return null
  val p = earth.cameraGeospatialPose
  return mapOf(
    "latitude" to p.latitude, "longitude" to p.longitude, "altitude" to p.altitude,
    "horizontalAccuracy" to p.horizontalAccuracy, "verticalAccuracy" to p.verticalAccuracy,
    "headingAccuracy" to p.orientationYawAccuracy)
}

fun addGeoAnchor(lat: Double, lng: Double, alt: Double?, heading: Double): Map<String, Any?>? {
  val earth = sceneView.session?.earth ?: return err("no_earth")
  if (earth.trackingState != TrackingState.TRACKING) return err("not_localized")
  val q = headingToEastUpSouthQuaternion(heading)   // FloatArray(4)
  val anchor = if (alt != null) earth.createAnchor(lat, lng, alt, q)
               else earth.createAnchorOnTerrain(lat, lng, 0.0, q)  // terrain-relative
  val id = anchor.hashCode().toString()
  anchorsById[id] = anchor
  emitAnchors()
  return mapOf("id" to id)
}
```

`createAnchorOnTerrain` (and `createAnchorOnRooftop`) resolve altitude from VPS so you don't need to know the exact elevation — preferable for street-level content. Drive `onGeoStateChange` from `earth.trackingState` + `cameraGeospatialPose` in the existing `onFrame` loop.

## The `useArGeo` hook

```tsx
import { useState } from 'react';
import { useArSession } from '../useArSession';
import { GeoStateEvent, type GeoTrackingState, type GeospatialPose, type GeoAnchorInput } from './geospatial';

export function useArGeo() {
  const ar = useArSession();
  const [geoState, setGeoState] = useState<GeoTrackingState>('initializing');
  const [pose, setPose] = useState<GeospatialPose | null>(null);

  const onGeoStateChange = (e: { nativeEvent: unknown }) => {
    const g = GeoStateEvent.parse(e.nativeEvent);
    setGeoState(g.state); setPose(g.pose);
  };

  // Only place once localized AND accuracy is good enough — see gotchas.
  const canPlace = geoState === 'localized'
    && !!pose && pose.horizontalAccuracy <= 1.5 && pose.headingAccuracy <= 15;

  const dropGeoAnchor = (input: GeoAnchorInput) =>
    canPlace ? ar.ref.current?.addGeoAnchor?.(input) : undefined;

  return { ...ar, geoState, pose, canPlace, dropGeoAnchor, handlers: { ...ar.handlers, onGeoStateChange } };
}
```

## Build / config delta

Add to the config plugin (`config-plugin.md`) only when geospatial is enabled:

- **iOS (both paths):** `NSLocationWhenInUseUsageDescription`. Path B also adds the `ARCore/Geospatial` pod.
- **Android (always):** `ACCESS_FINE_LOCATION`, `play-services-location` (>= 16) in `build.gradle`, and — for API-key auth — an `AndroidManifest` meta-data `com.google.android.ar.API_KEY`. The Android device also needs a magnetometer.
- **Cloud (Path B both platforms; Android always):** enable the **ARCore API** in a Google Cloud project, then authorize via **keyless** (recommended — sign JWTs on your server) or an **API key**. Keyless means standing up a token-signing endpoint.

A config-plugin snippet that injects the API-key meta-data and location permission:

```js
// inside withExpoAr, when props.geospatial is set:
config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.ACCESS_FINE_LOCATION']);
config = withAndroidManifest(config, (c) => {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
  app['meta-data'] = app['meta-data'] || [];
  if (props.arcoreApiKey && !app['meta-data'].some((m) => m.$['android:name'] === 'com.google.android.ar.API_KEY')) {
    app['meta-data'].push({ $: { 'android:name': 'com.google.android.ar.API_KEY', 'android:value': props.arcoreApiKey } });
  }
  return c;
});
```

## Gotchas

- **Gate placement on accuracy, not just "localized."** A localized session can still report multi-meter horizontal and large heading error; placing then puts content visibly off. Hold until `horizontalAccuracy` and `headingAccuracy` are within thresholds (the hook shows ~1.5 m / 15°; tune per use case), and surface a "improving accuracy…" state meanwhile.
- **Coverage is the gating reality.** Always `checkVpsAvailability` before offering geo placement; fall back to local world anchors where VPS is absent. ARKit geo is limited to supported cities; ARCore needs Street View coverage.
- **Outdoors, daylight, calibrate the compass.** VPS localizes from imagery + magnetometer; indoors or in poor light it may never localize. Prompt the user to pan across buildings.
- **Keyless auth = a backend.** Don't discover this late — Path B (and Android API access) needs the ARCore API enabled and tokens signed server-side unless you accept the less-secure API key.
- **Don't run both geo paths at once.** One session, one configuration; `trackingMode` switches it and restarts the session.
