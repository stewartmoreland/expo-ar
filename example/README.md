# expo-ar example

A development harness that demonstrates the [`expo-ar`](../README.md) module — one React Native AR view backed by ARKit (iOS) and ARCore (Android) — with two worked features composed on the same generic core:

- **Measure** — tap surfaces to drop points and get a live "measuring tape": per-segment length labels **pinned to the real object and tracking in 3D**, plus running distance/area in your choice of units.
- **Place** — tap surfaces to drop world-anchored 3D objects.
- **Geo** — switch to VPS/geospatial tracking and drop anchors at real-world lat/long.
- **Detect** — on-device **CV fusion**: detect objects on the AR camera's own frames, draw boxes (Skia), then **place a model on** or **measure** a detection — see [Computer vision (CV fusion)](#computer-vision-cv-fusion) below.

A glass segmented control at the top switches between them; each mode keeps its controls in a bottom action bar.

> **AR runs on real hardware only.** Neither ARKit nor ARCore works in the iOS Simulator or Android emulator, and **Expo Go cannot run this** (it needs native code). You must use a **development build** on a **physical device**.

## Run it (local dev build)

From the repository root:

```sh
npm install            # installs the module + example deps (postinstall links the module)
cd example
npx expo run:ios       # build & launch on a connected iPhone
# or
npx expo run:android   # build & launch on a connected Android device
```

This compiles the native module and installs a development build on the attached device. After the first build you can iterate on JS with Fast Refresh via `npx expo start --dev-client`.

## Run it (EAS dev build)

To build in the cloud instead of locally, link your own EAS project first — this populates `owner`/`projectId` so they're never committed to the repo:

```sh
cd example
eas init                                     # links this app to YOUR EAS project
eas build --profile development --platform ios      # or android
```

Install the resulting build on your device, then start the bundler:

```sh
npx expo start --dev-client
```

The `development` profile (see [`eas.json`](./eas.json)) produces an internal-distribution dev client. [`.easignore`](../.easignore) keeps the module's compiled JS (`build/`, `plugin/build/`) in the build archive while excluding heavy native build dirs.

## What the demos show

| Demo | Tap a surface to… | Controls |
| ---- | ----------------- | -------- |
| **Measure** | drop point 1, 2, 3… | `Add point` (drops at the reticle), `Undo`, `Clear`; chips toggle **mode** (distance / area) and **unit** (m / cm / ft / in) |
| **Place** | drop a world-anchored cube | `Place`, `Remove last`, `Clear` |
| **Detect** | (point at objects) | `Place` (anchors a model on the top detection), `Measure` (its real width), `Clear` |

The reticle is dead-center; in Measure it shows the next point number. Aim it at a surface and either tap the screen or press the primary button.

## How it maps to the module API

The example is pure composition over the generic core — it adds no session/tracking code. Each mode is a thin hook over the same primitives: [`features/useArMeasure.tsx`](./features/useArMeasure.tsx) and [`features/useArPlacement.tsx`](./features/useArPlacement.tsx).

- **Tap to place** → `onTap` → `addAnchor(x, y)` raycasts and creates an anchor; `onAnchorsChange` feeds the JS state. Placement then calls `attachModel(id, 'builtin:cube')` to render a cube at the anchor (see `useArPlacement`).
- **Measurement** is derived in pure TS from the anchor positions (see [`features/measurement.ts`](./features/measurement.ts)); distances are in meters, formatted only at the UI edge.
- **Object-pinned labels** use the opt-in `emitProjections` prop + `onProjection` event: the native side projects each anchor to screen space every frame, and the HUD pins a glass length chip at each segment's midpoint (see [`features/MeasurementLabels.tsx`](./features/MeasurementLabels.tsx)).
- **Undo / Clear** reuse the core's `removeAnchor` / `reset` (placement detaches each model before removing its anchor).

## Computer vision (CV fusion)

The **Detect** demo runs on-device computer vision on the AR session's **own** camera frames (the AR session owns the camera exclusively — you can't also run VisionCamera/`expo-camera` for CV), then lifts each 2D detection into world space with the core `raycast` primitive. The `expo-ar` module is **provider-agnostic**: it ships the detection contract, a throttle/skip-while-in-flight scaffold, the `addAnchorAtWorld` primitive, and a native **frame-processor registry** — but **no model and no ML dependency**. The concrete inference lives in a local module, [`modules/ar-detectors`](./modules/ar-detectors/README.md):

- **iOS** → Apple **Vision** (`VisionObjectProcessor`)
- **Android** → Google **ML Kit** object detection (`MlKitObjectProcessor`)

Both register under the name `objects`, which `App.tsx` passes as `<ExpoArView detectionModel="objects" />`. The JS side ([`features/useArDetect.tsx`](./features/useArDetect.tsx)) consumes `onDetections`, draws boxes on a `@shopify/react-native-skia` canvas ([`features/DetectionHUD.tsx`](./features/DetectionHUD.tsx)), and runs the two fusion modes: **detect-then-place** (`addAnchorAtWorld` → `attachModel`) and **detect-then-measure** (`raycast` the box edges → distance).

### Supplying a Core ML / Vision model

Out of the box the iOS processor is **zero-asset** (`VNRecognizeAnimalsRequest` → labeled boxes for cats/dogs) so the example builds with no model. To test **real object detection**, drop a model into the local module — **not** into the gitignored `ios/` app project (it'd be wiped by `expo prebuild`):

```
example/modules/ar-detectors/ios/Models/
└── YOLOv3.mlpackage         # any object-detection .mlmodel/.mlpackage; any name
```

```sh
cd example
npx expo prebuild            # re-runs pod install → bundles & compiles the model
npx expo run:ios             # physical device — ARKit doesn't run in a simulator
```

`VisionObjectProcessor` **auto-loads** the first model it finds in that folder (no code change), falling back to the zero-asset detector when it's empty. The model must be an **object-detection** model that Vision surfaces as `VNRecognizedObjectObservation` (boxes + labels) — e.g. **YOLOv3** from Apple's [Core ML model gallery](https://developer.apple.com/machine-learning/models/) or a **Create ML → Object Detection** model; a plain image *classifier* won't produce boxes. Full details (and the optional custom-TFLite path for Android, `android/src/main/assets/`) are in the [`ar-detectors` README](./modules/ar-detectors/README.md).

**Confirm it loaded.** The Detect HUD shows `detector: YOLOv3` when your model is live, or `detector: fallback (animals)` when none was found (only cats/dogs detect, via `VNRecognizeAnimalsRequest`). The Xcode console logs `[ArDetectors] active detector: …` plus any Vision errors or wrong-model-type warnings. The processor searches both the framework and app **main bundle** for the model — necessary because the CocoaPods static-framework resource bundle lands in the main bundle. Detection assumes **portrait** orientation.

> First-time setup pulls `@shopify/react-native-skia` (the box overlay) via `npm install`, and `expo prebuild` autolinks the `ar-detectors` local module. On Android, if Gradle can't resolve `:expo-ar`, run `./gradlew projects` in `example/android` and adjust the path in the local module's `build.gradle` (see its README).

## Troubleshooting

- **Black camera frame:** an AR session owns the camera exclusively — never stack the AR view over `expo-camera`. Only one is on screen at a time.
- **Taps don't place points:** move the device slowly until tracking reaches `normal` (the reticle turns mint). On Android, depth hits need `depthEnabled` (on here) and a supported device.
- **Nothing happens in a simulator/emulator:** expected — use a physical device.
- **Detect shows no boxes:** the iOS fallback only finds **animals** until you drop a real model into [`modules/ar-detectors/ios/Models/`](./modules/ar-detectors/README.md); ML Kit's default Android detector finds coarse object categories. Also lower `minConfidence` on the `<ExpoArView>` in `App.tsx`.
- **Android session stalls after a few seconds in Detect:** a frame processor that doesn't `image.close()` every acquired image exhausts ARCore's buffer pool — `MlKitObjectProcessor` closes in `addOnCompleteListener`; keep that if you swap in your own.
