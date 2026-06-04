# Extension — CV fusion (detect-then-place / detect-then-measure)

Run on-device computer vision on the AR session's own camera frames, then lift each 2D detection into world space with the core `raycast` primitive — so you can drop a model on a recognized object (**detect-then-place**) or read a detected object's real-world size (**detect-then-measure**). Builds on the per-frame pixel-buffer hooks documented in `ios-arkit.md` and `android-arcore.md`.

## Why this lives inside the AR module

The AR session owns the camera exclusively — you cannot also run VisionCamera or `expo-camera` for the CV (the camera-exclusivity rule from `SKILL.md`). So the CV must run on the frames the AR session already hands you (`frame.capturedImage` on iOS, `frame.acquireCameraImage()` on Android), inside the native view. The module emits only **results** (boxes + optional world transforms) to JS — never frames, which are far too large for the bridge. This is the one architecture that gives you detection *and* world tracking on one camera at once.

## What CV fusion reuses vs. adds

| Concern | Reuses from core | Adds |
|---|---|---|
| Get frames | per-frame delegate/`onFrame` hook | native model inference on a background queue |
| 2D → 3D | `raycast(x, y)` | mapping detection coords → view coords (orientation-aware) |
| Place on a detection | `addAnchor` + rendering (`object-placement.md`) | pick a detection, anchor at its world transform |
| Measure a detection | distance math (`measurement.md`) | raycast box corners → real width/height |
| Draw boxes | 2D HUD slot | a **Skia** per-frame overlay (boxes move every frame) |

Unlike geospatial, this does **not** change the session configuration — it's a feature layered on the frame-access hooks, so it slots in like measurement/placement.

## Contract additions — `features/detection.ts`

Detections carry a view-normalized box (0–1, already orientation-corrected) plus an optional `worldTransform` (the core raycast of the box center, done in the *same* frame so it doesn't lag).

```typescript
import { z } from 'zod';
import { Transform } from '../types';

export const Detection = z.object({
  id: z.string(),                       // stable per track if the model supports tracking
  label: z.string(),
  confidence: z.number(),
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }), // view-normalized
  worldTransform: Transform.nullable(), // center raycast result, or null if no surface hit
});
export type Detection = z.infer<typeof Detection>;

export const DetectionsEvent = z.object({ detections: z.array(Detection) });
```

View-surface additions (Swift + Kotlin, identical names):
- **Props:** `detectionEnabled` (`boolean`), `detectionModel` (`string` — bundled model name/uri), `minConfidence` (`number`), `detectionFps` (`number`, throttle; default ~10).
- **Event:** `onDetections({ detections })` — emitted at the throttled cadence, not every frame.
- No new functions needed — placing/measuring reuse the core `addAnchor`/`raycast` and the existing math.

## iOS pipeline — Vision + Core ML on `ARFrame.capturedImage`

Idiomatic iOS CV is Vision + Core ML (not ML Kit). Run it off the delegate thread and skip frames while a request is in flight.

```swift
import Vision
import ARKit

extension ExpoArView {
  // Called from session(_:didUpdate:) — keep that thread free.
  func process(_ frame: ARFrame) {
    guard detectionEnabled, !inFlight else { return }
    inFlight = true
    let buffer = frame.capturedImage            // CVPixelBuffer, sensor-oriented (NOT display)
    let orientation = cgOrientation()           // derive from UIDevice/interface orientation
    let viewport = bounds.size

    visionQueue.async { [weak self] in
      guard let self else { return }
      let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: orientation)
      try? handler.perform([self.request])      // self.request = a cached VNCoreMLRequest
      let observations = (self.request.results as? [VNRecognizedObjectObservation]) ?? []

      // Vision boxes are normalized, origin bottom-left. displayTransform maps them into
      // the view accounting for orientation + aspect-fill — use it instead of hand-rolling.
      let t = frame.displayTransform(for: .portrait, viewportSize: viewport)
      let dets: [[String: Any]] = observations
        .filter { $0.confidence >= Float(self.minConfidence) }
        .map { obs in
          let viewRect = obs.boundingBox.applying(t)        // normalized view rect
          let centerPx = CGPoint(x: viewRect.midX * viewport.width, y: (1 - viewRect.midY) * viewport.height)
          let hit = self.raycast(at: centerPx)              // core primitive, same frame
          return [
            "id": UUID().uuidString,
            "label": obs.labels.first?.identifier ?? "object",
            "confidence": obs.confidence,
            "bbox": ["x": viewRect.minX, "y": 1 - viewRect.maxY, "w": viewRect.width, "h": viewRect.height],
            "worldTransform": hit["worldTransform"] ?? NSNull(),
          ]
        }
      DispatchQueue.main.async { self.onDetections(["detections": dets]); self.inFlight = false }
    }
  }
}
```

Cache the `VNCoreMLModel`/`VNCoreMLRequest` once (don't rebuild per frame), run on a serial `visionQueue`, and leave `usesCPUOnly = false` so it uses the Neural Engine.

## Android pipeline — ML Kit / LiteRT on `acquireCameraImage()`

Use ML Kit Object Detection (or a LiteRT/TFLite or MediaPipe model). **Always close the image** — ARCore has a small pool of image buffers and the session stalls after a few frames if you don't.

```kotlin
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame

fun process(frame: Frame) {
  if (!detectionEnabled || inFlight) return
  val image = try { frame.acquireCameraImage() } catch (_: Exception) { return } // may be unavailable
  inFlight = true
  val rotation = displayRotationDegrees()
  // Feed `image` (YUV_420_888) to ML Kit: InputImage.fromMediaImage(image, rotation).
  detector.process(/* InputImage */).addOnSuccessListener { objects ->
    val dets = objects.filter { (it.labels.firstOrNull()?.confidence ?: 0f) >= minConfidence }.map { obj ->
      // Map the box from IMAGE space to VIEW space with ARCore's coordinate transform.
      val inView = FloatArray(4)
      frame.transformCoordinates2d(
        Coordinates2d.IMAGE_PIXELS, floatArrayOf(obj.boundingBox.exactCenterX(), obj.boundingBox.exactCenterY()),
        Coordinates2d.VIEW, inView)
      val hit = raycast(inView[0], inView[1])         // core primitive, same frame
      mapOf(
        "id" to (obj.trackingId?.toString() ?: java.util.UUID.randomUUID().toString()),
        "label" to (obj.labels.firstOrNull()?.text ?: "object"),
        "confidence" to (obj.labels.firstOrNull()?.confidence ?: 0f),
        "bbox" to normalizedViewBox(obj.boundingBox, frame), // map all 4 corners IMAGE->VIEW, normalize
        "worldTransform" to hit["worldTransform"])
    }
    onDetections(mapOf("detections" to dets))
  }.addOnCompleteListener {
    image.close()                                     // MUST close, or the session stalls
    inFlight = false
  }
}
```

`frame.transformCoordinates2d` handles rotation and image-vs-view aspect for you — prefer it over manual coordinate math, which is the usual source of misaligned boxes.

## Mode 1 — detect-then-place

JS watches `onDetections`, lets the user tap a box (or auto-picks the highest-confidence one), and anchors at that detection's `worldTransform`:

```tsx
const place = async (d: Detection) => {
  if (!d.worldTransform) return;            // nothing solid behind it
  const res = await ar.ref.current?.addAnchorAtWorld?.(d.worldTransform); // add this fn alongside addAnchor
  if (res?.id) attachModel(res.id, modelUri); // reuse object-placement rendering
};
```

(Add a small `addAnchorAtWorld(transform)` function to the core view — a sibling of `addAnchor(x,y)` that skips the raycast since CV already has the transform.)

## Mode 2 — detect-then-measure

Raycast two opposite box corners (not just the center) into world space and measure between them with the existing distance math:

```tsx
import { distanceBetween } from '../transform';

const measureWidth = async (d: Detection) => {
  const left  = await ar.ref.current?.raycast(d.bbox.x * W, (d.bbox.y + d.bbox.h / 2) * H);
  const right = await ar.ref.current?.raycast((d.bbox.x + d.bbox.w) * W, (d.bbox.y + d.bbox.h / 2) * H);
  if (left?.worldTransform && right?.worldTransform)
    return distanceBetween(left.worldTransform, right.worldTransform); // meters
};
```

**Accuracy caveat — state it to the user.** Box corners raycast to whatever surface is *behind* them, so this measures an object's footprint or its silhouette against a backdrop, not a free-floating object's true extent. It is reliable when the object sits on/against a detected plane, and far better with LiDAR/Depth on (raycasts hit the object's own mesh). For precise dimensions, prefer measuring on the reconstructed mesh.

## Drawing the boxes — Skia, not RN views

Boxes move every frame, so render them on a `@shopify/react-native-skia` `Canvas` over the AR view (the per-frame overlay case from `js-contract.md` §5); re-rendering RN `<View>`s at detection cadence is janky. Scale the view-normalized `bbox` to the canvas size, draw a neon stroked rounded rect + label. World-anchored content placed via Mode 1 is still rendered natively, not in Skia.

```tsx
// Sketch: a Skia Canvas reading the latest detections from a shared value updated by onDetections.
// Stroke each bbox (x*w, y*h, w*w, h*h); draw label text above it.
```

## Throttling & performance gotchas

- **Throttle and skip-while-in-flight.** Never run the model on every frame; cap at ~`detectionFps` (10–15 is plenty) and drop frames while a request is pending. Blocking the AR delegate/update thread stutters tracking.
- **Background queue.** Inference runs off the AR thread; marshal results back to the main/JS thread.
- **Android: close every acquired image.** The top ARCore CV bug — unclosed images exhaust the buffer pool and `acquireCameraImage()` starts failing.
- **Orientation is where boxes go wrong.** Use `displayTransform` (iOS) / `transformCoordinates2d` (Android) rather than hand-mapping; the captured buffer is sensor-oriented, not display-oriented.
- **Raycast in the same frame as the detection.** Doing it natively avoids the temporal gap you'd get round-tripping the box to JS and back while the camera keeps moving.
- **Don't bridge frames.** Emit only detections (and transforms). If you find yourself sending pixel data to JS, stop — that's the VisionCamera-vs-AR tradeoff resolved the wrong way.

## Why this is the capstone extension

Detect-then-place and detect-then-measure combine all three layers the module exposes — the frame hook, the `raycast` primitive, and anchors/rendering — without touching session, tracking, or lifecycle. It's the proof that the core is not just use-case agnostic but *composable*: a genuinely new capability (on-device CV fused with world tracking) drops in as a feature, exactly like the simpler examples.
