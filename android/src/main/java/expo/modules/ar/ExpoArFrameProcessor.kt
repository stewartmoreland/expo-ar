package expo.modules.ar

import com.google.ar.core.Frame

// CV-fusion provider seam (Android). The module ships NO model and NO ML dependency — it owns only
// the throttle / skip-while-in-flight scaffold and emits onDetections. A consuming app registers a
// concrete processor (ML Kit, LiteRT/TFLite, MediaPipe, …) into the registry below; the AR view
// calls it per throttled frame with the session's own ARCore Frame (camera-exclusivity means CV must
// run on these frames) plus a same-frame `raycast` closure for 2D→3D lifting.
//
// The processor returns detection maps whose keys match the Detection contract in
// src/ExpoAr.types.ts byte-for-byte: "id", "label", "confidence", "bbox" {x,y,w,h} (view-normalized
// 0–1), "worldTransform" (16-float column-major, or null).
//
// Contract for the processor:
//  - Inference is async (ML Kit returns via a listener). Call `onResult` when done — the view clears
//    its in-flight flag and emits then.
//  - `viewWidth`/`viewHeight` are the AR view's size in PIXELS — use them to map ARCore VIEW pixels
//    into the 0–1 view-normalized bbox the contract expects.
//  - `raycast(x, y)` takes view-space PIXELS (the same space as ARCore Coordinates2d.VIEW), and the
//    view converts to dp internally — so pass transformCoordinates2d(…, VIEW, …) output straight in.
//  - If you call frame.acquireCameraImage(), you MUST close() it (the top ARCore CV bug: unclosed
//    images exhaust the buffer pool and the session stalls). Acquire synchronously inside process().
interface ExpoArFrameProcessor {
  fun process(
    frame: Frame,
    viewWidth: Int,
    viewHeight: Int,
    minConfidence: Double,
    raycast: (Float, Float) -> Map<String, Any?>,
    onResult: (List<Map<String, Any?>>) -> Unit,
  )

  // Human-readable label of what's actually running (e.g. "ML Kit (bundled)"), for debugging which
  // model is live. Surfaced to JS via the module's getDetectorInfo. Defaulted (interface getter) so
  // processors that don't care need not implement it.
  val activeModelLabel: String
    get() = ""
}

/** Process-wide registry of named frame processors. The `detectionModel` prop selects which one the
 * view runs. Register from app/native startup (e.g. an Expo module's OnCreate). Thread-safe. */
object ExpoArDetectorRegistry {
  private val processors = mutableMapOf<String, ExpoArFrameProcessor>()

  @Synchronized
  fun register(name: String, processor: ExpoArFrameProcessor) {
    processors[name] = processor
  }

  @Synchronized
  fun unregister(name: String) {
    processors.remove(name)
  }

  @Synchronized
  fun processor(name: String): ExpoArFrameProcessor? =
    if (name.isEmpty()) null else processors[name]
}
