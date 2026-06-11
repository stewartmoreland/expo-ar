# ar-detectors (example local module)

Concrete CV inference for the expo-ar **CV-fusion** demo. The `expo-ar` module itself is
provider-agnostic: it ships the detection contract, the throttle/skip-while-in-flight scaffold, the
`addAnchorAtWorld` primitive, and a native **frame-processor registry** — but **no model and no ML
dependency**. This local module supplies the actual inference and registers it into that registry:

| Platform | Processor | Backend |
| --- | --- | --- |
| iOS | `VisionObjectProcessor` | Apple **Vision** (`VNRecognizeAnimalsRequest`, zero-asset) |
| Android | `MlKitObjectProcessor` | Google **ML Kit** object detection (bundled default model) |

Both register under the name **`objects`**, which is what `App.tsx` passes as
`<ExpoArView detectionModel="objects" />`.

## How it fits together

```
<ExpoArView detectionEnabled detectionModel="objects" onDetections=… />
        │  (per throttled frame, native — never bridges camera frames)
        ▼
expo-ar view → ExpoArDetectorRegistry.processor("objects")
        │  hands it the AR frame + a same-frame raycast closure
        ▼
VisionObjectProcessor / MlKitObjectProcessor  (THIS module)
        │  runs inference, maps boxes sensor→view, raycasts each center
        ▼
expo-ar emits onDetections({ detections }) → useArDetection → Skia HUD
```

This is the only way to get detection **and** world tracking on one camera at once (the AR session
owns the camera exclusively — you cannot also run VisionCamera/expo-camera for CV).

## Setup

No JS import — it autolinks as a local module and registers itself natively. After adding it:

```sh
cd example
npm install            # pulls @shopify/react-native-skia (HUD)
npx expo prebuild      # regenerates ios/ & android/ and links this module
npx expo run:ios       # physical device — ARKit/ARCore don't run in a simulator
npx expo run:android   # physical, ARCore-supported device
```

### Autolinking: why `searchPaths` is required here

This example points `expo.autolinking.nativeModulesDir` at `..` to link the **in-development**
`expo-ar` source, which **replaces** the default `./modules` local-module scan — so this module is
invisible unless `./modules` is added back as a search path. That's why `example/package.json` has:

```json
"expo": {
  "autolinking": {
    "nativeModulesDir": "..",
    "searchPaths": ["./modules"]
  }
}
```

If the Detect HUD shows **`detector: none registered`**, this module didn't autolink — confirm the
`searchPaths` entry above is present and **re-run `npx expo prebuild`** (then rebuild). Verify discovery
without a full build:

```sh
cd example && npx expo-modules-autolinking resolve -p apple   # should list 'ar-detectors'
```

### Android: verify the `:stewmore-expo-ar` project path

`android/build.gradle` here depends on the expo-ar module for the seam types:

```gradle
implementation project(':stewmore-expo-ar')
```

Scoped npm package `@stewmore/expo-ar` autolinks as Gradle project `stewmore-expo-ar` (slash →
hyphen). If a build can't resolve it, verify the autolinked name:

```sh
cd example && npx expo-modules-autolinking resolve -p android | grep stewmore-expo-ar
```

Fallback — list all Gradle projects after prebuild:

```sh
cd example/android && ./gradlew projects
```

## Testing with a real model — where to drop it

The defaults are zero-asset so the example builds out of the box. To run **real CV**, drop a model
into the platform folder below and rebuild (`npx expo prebuild && npx expo run:ios|android`). These
folders are committed and survive prebuild — **never** drop models into the gitignored
`example/ios/` or `example/android/` app projects.

| Platform | Drop your model in | Wiring |
| --- | --- | --- |
| **iOS** (Core ML) | [`ios/Models/`](./ios/Models/README.md) | **Automatic** — the podspec bundles it and `VisionObjectProcessor` auto-loads the first model it finds (else the zero-asset fallback). |
| **Android** (TFLite) | [`android/src/main/assets/`](./android/src/main/assets/README.md) | Two small edits (custom-model dep + `LocalModel`) — see that folder's README. |

### iOS in one line

Put an **object-detection** Core ML model (e.g. **YOLOv3** from Apple's
[model gallery](https://developer.apple.com/machine-learning/models/), or a Create ML object-detection
model — *not* a plain classifier) at `ios/Models/YourModel.mlpackage`, then:

```sh
cd example && npx expo prebuild && npx expo run:ios   # physical device
```

`VisionObjectProcessor` picks it up — no code change. The box mapping (a portrait aspect-fill fit, see
below) and same-frame raycast are identical whether it's your model or the fallback.

You can also use an entirely different runtime (`onnxruntime-react-native`, `react-native-executorch`)
by writing a new processor and registering it under a name in `ArDetectorsModule`. Because the seam is
provider-agnostic, none of this touches the `expo-ar` module.

### Confirming your model actually loaded

The processor loads from a CocoaPods **static-framework** resource bundle, which lands in the **app's
main bundle** — `VisionObjectProcessor` searches both the framework and main bundles, so a dropped
model is found. To confirm which detector is live:

- **On screen:** the Detect HUD shows `detector: <name>`:
  - `detector: YOLOv3` — your model loaded ✅
  - `detector: fallback (animals)` — the module loaded but found no Core ML model (only cats/dogs detect)
  - `detector: none registered` — the `ar-detectors` module didn't autolink (see [Autolinking](#autolinking-why-searchpaths-is-required-here)); re-run `expo prebuild`
- **Xcode console:** `[ArDetectors] active detector: …` at launch; Vision errors and
  wrong-model-type warnings (`model returned … not VNRecognizedObjectObservation`) are logged too.

The model **must be an object-detection model** Vision surfaces as `VNRecognizedObjectObservation`
(boxes + labels) — Apple's gallery **YOLOv3** qualifies; a plain image *classifier* produces no boxes
and the HUD count stays 0 (watch for the wrong-model-type log).

**Orientation / box alignment.** Vision runs on the `.right`-oriented buffer (upright for a
portrait-held device), so it returns boxes in **upright portrait** normalized space. The processor maps
those straight to view-normalized rects with a portrait **aspect-fill** fit (`viewRect(...)`) — it does
**not** route them through `ARFrame.displayTransform`, which expects coordinates in the *native sensor
(landscape)* space and would double-apply the landscape→portrait rotation (a wide keyboard then renders
as a tall, mis-placed box). Detection assumes **portrait**; full device-rotation support is not wired.

> Not to be confused with ARKit's [3D object detection](https://developer.apple.com/documentation/arkit/scanning-and-detecting-3d-objects)
> (`ARReferenceObject` / `ARObjectScanningConfiguration`) — that detects *specific pre-scanned* objects
> with 6DOF pose, a different feature from this Vision-based **arbitrary** 2D object detection.
