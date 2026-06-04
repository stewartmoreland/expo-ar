import ARKit

// CV-fusion provider seam (iOS). The module itself ships NO model and NO ML dependency — it only
// owns the throttle / skip-while-in-flight scaffold and emits onDetections. A consuming app
// registers a concrete processor (Apple Vision, Core ML, onnxruntime, …) into the registry below;
// the AR view calls it per throttled frame with the session's own ARFrame (camera-exclusivity means
// CV must run on these frames) plus a same-frame `raycast` closure for 2D→3D lifting.
//
// The processor returns detection dicts whose keys match the Detection contract in
// src/ExpoAr.types.ts byte-for-byte: id, label, confidence, bbox {x,y,w,h} (view-normalized 0–1),
// worldTransform (16-float column-major, or NSNull). Run inference OFF the delegate thread and call
// `completion` when done — the view clears its in-flight flag and emits on the main thread.
public protocol ExpoArFrameProcessor: AnyObject {
  func process(
    frame: ARFrame,
    viewportSize: CGSize,
    minConfidence: Double,
    raycast: @escaping (CGPoint) -> [String: Any],
    completion: @escaping ([[String: Any]]) -> Void)

  // Human-readable label of what's actually running (e.g. "YOLOv3" or a fallback note), for debugging
  // which model loaded. Surfaced to JS via the module's getDetectorInfo. Defaulted so processors that
  // don't care need not implement it.
  var activeModelLabel: String { get }
}

public extension ExpoArFrameProcessor {
  var activeModelLabel: String { "" }
}

/// Process-wide registry of named frame processors. The `detectionModel` prop selects which one the
/// view runs. Register from app/native startup (e.g. an Expo module's OnCreate). Thread-safe.
public final class ExpoArDetectorRegistry {
  private static let lock = NSLock()
  private static var processors: [String: ExpoArFrameProcessor] = [:]

  public static func register(name: String, processor: ExpoArFrameProcessor) {
    lock.lock()
    defer { lock.unlock() }
    processors[name] = processor
  }

  public static func unregister(name: String) {
    lock.lock()
    defer { lock.unlock() }
    processors[name] = nil
  }

  public static func processor(for name: String) -> ExpoArFrameProcessor? {
    guard !name.isEmpty else { return nil }
    lock.lock()
    defer { lock.unlock() }
    return processors[name]
  }
}
