---
name: expo-ar
description: Build a custom Expo native module (`expo-ar`) that bridges Apple's ARKit (Swift) and Google's ARCore (Kotlin) into one React Native view — the foundation for any on-device AR feature, covering world tracking, plane detection, hit-testing/raycasting, anchors, placing 3D content, room scanning, and LiDAR (iOS) / ARCore Depth API (Android). Use this whenever the user wants AR in an Expo/React Native app, a native AR camera view, ARKit or ARCore integration, world-anchored overlays, tap-to-place 3D objects, surface/plane detection, or depth/LiDAR scanning — or asks how expo-camera relates to AR (a confusion this corrects). Trigger even when they only say things like 'add AR to my app,' 'place a model in the real world,' 'scan a room,' or name just one SDK, and use it as the base for specific AR features like measurement, since those build on this module. It is use-case agnostic; measurement and object placement are worked examples on the same core.
---

# expo-ar — a custom ARKit + ARCore module for Expo

This skill builds **`expo-ar`**, one custom Expo native module that gives a React Native app a real AR view backed by ARKit on iOS and ARCore on Android. It is deliberately **use-case agnostic**: the module exposes the generic AR primitives (session, tracking, raycasting, anchors, planes, depth/mesh, frame access) and a clean JS↔native contract, and specific features are composed on top. Two worked examples ship with the skill — AR measurement and tap-to-place object placement — but they are illustrations of the core, not the core itself.

## The one thing to get right first: expo-camera is NOT an AR layer

The most common (and fatal) mistake is to render `<CameraView>` from `expo-camera` and try to draw ARKit/ARCore content on top of it. **That does not work.** An ARKit `ARSession` or ARCore `Session` takes *exclusive* control of the camera hardware and renders its own camera feed; you cannot have `expo-camera` and an AR session both holding the camera at once.

So the relationship is **sibling capabilities, not stacked layers**:

- **The `expo-ar` view owns the camera whenever AR is active.** It embeds the platform AR renderer (`ARSCNView`/`ARView` on iOS, an ARCore-backed `SceneView` on Android), shows the camera and any world-anchored 3D content together, natively. React Native draws its 2D UI (buttons, HUD, labels) on top as normal RN elements.
- **`expo-camera` is for the non-AR paths** — devices without ARKit/ARCore, and anywhere the app just needs photos/video. The two coexist in one app but never run on the same screen at the same time.

If a user insists on compositing AR over `expo-camera`, explain this plainly instead of producing code that silently yields a black frame. (Note: real-time computer-vision overlays like detection boxes are a *different* problem — those don't need exclusive AR control and are often better served by a VisionCamera frame processor. But anything world-anchored belongs in `expo-ar`.)

## Architecture

```
React Native (TypeScript)
├── hooks (useArSession, + per-feature hooks) ... session state, anchors, tracking
├── <ExpoArView/> ........................ requireNativeViewManager — camera + 3D content
├── 2D overlays (RN / Skia) .............. HUD drawn over the native view
└── contract (Zod) ....................... props, events, function signatures, payload shapes
        │  props & async fn calls down              events up
        ▼                                            ▲
Expo Modules API — ONE view, two platform implementations of the SAME contract
│  Generic AR primitives (the use-case-agnostic core):
│   • session lifecycle: run / pause / resume / reset (+ focus/blur handling)
│   • tracking state events
│   • raycast(x,y) → world transform        ← the universal "screen point → 3D" primitive
│   • anchors: add / remove / list + onAnchorsChange
│   • plane detection (horizontal / vertical)
│   • depth / mesh: LiDAR sceneReconstruction (iOS) · Depth API (Android)
│   • per-frame camera pixel buffer access (for fusing on-device CV)
│   • snapshot()
├── iOS:     ARKit (ARWorldTrackingConfiguration) + SceneKit/RealityKit rendering
└── Android: ARCore (Session) + SceneView (Filament) rendering
        │
        ▼
Config plugin ── camera permission, ARKit/ARCore manifest entries, gradle dep, prebuild
```

Read the references in this order; the contract is the glue, the platform files implement it, the examples compose it:

| Layer | What it covers | Reference |
|---|---|---|
| **JS contract** | Designing props/events/functions, Zod payloads, the native-view wrapper, hook + overlay patterns (incl. event-driven RN vs per-frame Skia) | `references/js-contract.md` |
| **iOS core** | Generic ARKit module/view: session, lifecycle, tracking, raycast, anchors, planes, LiDAR mesh, frame buffer | `references/ios-arkit.md` |
| **Android core** | Generic ARCore module/view: session + install flow, config, depth, hit-test, anchors, planes, frame image | `references/android-arcore.md` |
| **Build config** | Local-module scaffold, config plugin, `app.json`, prebuild | `references/config-plugin.md` |
| **Examples** | Measurement (`examples/measurement.md`) · tap-to-place objects (`examples/object-placement.md`) | `references/examples/` |

Don't hold all five in your head at once. Lock the contract, implement the platform core(s), then compose the feature from an example.

## Build workflow (follow in order)

AR requires native code, so **Expo Go cannot run this** — you need a development build. Scaffold the module and get a *blank tracking AR view* working before any feature logic.

1. **Confirm project shape.** Expo SDK 50+ with the Expo Modules API. A managed CNG project (no `ios/`/`android/`) is fine — the config plugin handles native config and `expo prebuild` generates the projects. Confirm EAS Build or a local dev build is available; Expo Go is out.
2. **Scaffold the local module:** `npx create-expo-module@latest --local expo-ar` (autolinks under `modules/`). Standalone npm package only if it'll be shared across apps. Layout is in `references/config-plugin.md`.
3. **Define the contract** (`references/js-contract.md`) before native code. Both Swift and Kotlin must emit byte-for-byte identical event names and payload keys — mismatches are the #1 "event never fires" bug.
4. **Implement capability detection** — a synchronous module function returning `{ arSupported, depthOrLidarAvailable }` so JS branches to AR vs the `expo-camera` fallback *before* mounting the view.
5. **Get a blank, tracking AR view on screen** (both platforms) with `onReady` + `onTrackingStateChange` firing, before any feature. This isolates module wiring from feature bugs.
6. **Verify the primitives** — `raycast`, `addAnchor`, `onAnchorsChange`, `pause`/`resume`. Everything else composes from these.
7. **Compose your feature** from an example (or your own), adding feature-specific functions/events/rendering on the base view.
8. **Wire the config plugin**, `expo prebuild`, build, and test on **physical devices** — neither ARKit nor ARCore runs in a simulator/emulator.

## Capability detection & graceful degradation

Three device tiers — detect and branch, never assume LiDAR/Depth:

| Tier | iOS | Android | What works |
|---|---|---|---|
| **Best** | LiDAR (`supportsSceneReconstruction`) | Depth API (`isDepthModeSupported(AUTOMATIC)`) | Accurate depth on arbitrary surfaces, low light, untextured walls; mesh occlusion |
| **Good** | ARKit world tracking, no LiDAR | ARCore, no depth | Tracking + planes; accurate only on well-lit, textured surfaces & detected planes |
| **None** | No ARKit | Not in ARCore device list | No AR — fall back to `expo-camera` |

On iOS, LiDAR availability = `ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)`. On Android, ARCore's Depth API works via depth-from-motion ML even with **no** time-of-flight sensor — so gate on "Depth supported," not "has ToF hardware," and remember depth is **off by default** and must be enabled explicitly. When depth/LiDAR is present, enabling mesh/scene reconstruction lets raycasts hit real geometry (objects, walls) rather than only flat detected planes — the single biggest accuracy and realism win, and the reason to bother with LiDAR at all.

## The generic AR contract (the use-case-agnostic core)

Keep this identical across Swift and Kotlin; `references/js-contract.md` is canonical.

- **Module function (no view):** `getCapabilities() → { arSupported, depthOrLidarAvailable }`.
- **Props (JS → native):** `planeDetection` (`"none"|"horizontal"|"vertical"|"both"`), `depthEnabled` (`boolean`), `debug` (`boolean`, draws detected planes/feature points).
- **Async functions (JS → native, via view ref):**
  - `raycast(x, y) → { worldTransform: number[] | null, target: "plane"|"mesh"|"depth"|"feature"|null }` — the universal primitive.
  - `addAnchor(x, y) → { id } | null` (raycast + create a persistent anchor).
  - `removeAnchor(id)`, `listAnchors()`.
  - `pause()`, `resume()`, `reset()`, `snapshot() → base64`.
- **Events (native → JS):** `onReady({ capabilities })`, `onTrackingStateChange({ state })`, `onTap({ x, y })`, `onAnchorsChange({ anchors:[{ id, transform, type }] })`, `onError({ code, message })`.

Everything a feature needs is expressed by composing these. Measurement = raycast on tap → store world points → compute geometry → draw lines natively. Object placement = `addAnchor` → attach a model node to that anchor. CV fusion = read the per-frame pixel buffer, run a model, `raycast` the detection's center to get its world position.

## Session lifecycle is where AR apps crash

Treat the session as a resource with strict ownership — this is the most common source of crashes and battery drain, so build it into the base view from the start, not as a feature concern:

- **Pause on blur / background, resume on focus.** A running `ARSession`/ARCore `Session` holds the camera and sensors. When the screen loses focus (navigation, app backgrounded) call `pause()`; on focus, `resume()`. On iOS hook `viewWillDisappear`/`willResignActive`; on Android tie to the host lifecycle (SceneView does much of this if you forward lifecycle events). Leaving it running drains battery and can crash on re-entry.
- **One session at a time, app-wide.** Two AR views, or an AR view plus VisionCamera/`expo-camera`, will fight over the camera. Mount exactly one AR view.
- **`reset()` clears anchors and restarts tracking** (`.resetTracking, .removeExistingAnchors` on iOS; recreate/reconfigure on Android). Offer it as a "start over" affordance.

## Overlay models: pick by cadence

Two distinct overlay needs, and using the wrong one is a common perf bug:

- **World-anchored 3D content** (placed models, measurement lines, mesh visualizations) is rendered **natively** by the AR view (SceneKit/RealityKit/SceneView), so it stays locked to the real world as the camera moves. JS sends commands; it does not draw this.
- **2D screen-space HUD** (buttons, a reticle, readouts, detection boxes) is plain **React Native** drawn over the view. For discrete, event-driven HUD (a readout that updates on each tap), RN state is fine. For anything updating every frame (e.g., boxes tracking at 30–60 fps), draw on a **Skia canvas** — re-rendering RN `<View>`s every frame is janky.

## Coordinate spaces & units

Both ARKit and ARCore use a right-handed, Y-up world space measured in **meters**, with the origin at the session's start pose. Anchor poses are 4×4 transforms; serialize them as a 16-number column-major array across the bridge, identically on both platforms. Keep all math in meters internally and convert to display units only at the UI edge. The conventions line up well enough that a shared TS layer can treat both platforms uniformly — the contract reference shows the transform/pose helpers.

## Common pitfalls (call out proactively)

- **Stacking AR on expo-camera** — the headline mistake; the AR view owns the camera.
- **Testing in a simulator/emulator** — ARKit/ARCore need real hardware and motion sensors. Always physical devices.
- **Skipping session pause/resume** — leaks, battery drain, crashes on re-entry. Build it into the base view.
- **Depth opt-in on Android** — without `setDepthMode(AUTOMATIC)`, no `DepthPoint` hits and accuracy collapses on objects.
- **ARCore install flow** — Google Play Services for AR may need a runtime install via `ArCoreApk.requestInstall`; SceneView handles it, but a hand-rolled session must.
- **Event name / payload drift between Swift and Kotlin** — emit identical names and keys; the Zod schema catches drift fast.
- **Acting before tracking is `normal`** — raycasts during `initializing`/`limited` return garbage; gate feature actions on tracking state.
- **Sending camera frames over the JS bridge** — too slow. Run CV natively (frame processor or inside the AR module) and emit only results.

---

Once a blank tracking view, the raycast primitive, and anchors work end-to-end on a real device, compose the target feature from an example and layer the HUD. Natural next steps to offer: anchor persistence (ARWorldMap / ARCore Cloud Anchors), mesh occlusion, and fusing on-device CV with raycasting for detect-then-place or detect-then-measure flows.
