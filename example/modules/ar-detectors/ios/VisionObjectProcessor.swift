import ARKit
import CoreML
import CoreVideo
import ExpoAr
import Vision

// Example Apple Vision frame processor implementing expo-ar's ExpoArFrameProcessor seam. It runs on
// the AR session's own ARFrame (camera-exclusivity — no VisionCamera/expo-camera), off the delegate
// thread, and emits detection dicts whose keys match the Detection contract.
//
// Model selection (no code change needed to test a real model):
//   • Drop a Core ML OBJECT-DETECTION model (.mlmodel/.mlpackage) into ios/Models/ — it's bundled by
//     the podspec and auto-loaded here as a VNCoreMLRequest (general object detection, e.g. YOLOv3).
//     The model must surface results as VNRecognizedObjectObservation (boxes + labels); a plain image
//     classifier won't produce boxes. Apple's gallery YOLOv3 qualifies.
//   • With no model present, it falls back to VNRecognizeAnimalsRequest — zero-asset, so the example
//     builds and runs out of the box (labeled boxes for cats/dogs).
// Both yield VNRecognizedObjectObservations, so the box mapping + same-frame raycast below are
// identical either way. `activeModelLabel` reports which is live (surfaced to JS via getDetectorInfo).
final class VisionObjectProcessor: ExpoArFrameProcessor {
  private let request: VNRequest
  // Human-readable label of what's actually running ("YOLOv3" or the animal-fallback note), exposed
  // through the seam so the HUD can show "did my model load?" without digging through Xcode logs.
  let activeModelLabel: String
  private let queue = DispatchQueue(label: "expo-ar.example.vision")
  // Log a result-type mismatch (e.g. a classifier model that yields no boxes) at most once.
  private var loggedResultMismatch = false

  init() {
    let (request, label) = VisionObjectProcessor.makeRequest()
    self.request = request
    self.activeModelLabel = label
    NSLog("[ArDetectors] active detector: %@", label)
  }

  // Build a VNCoreMLRequest from the first compiled model in the bundled Models, or fall back to the
  // zero-asset animal detector when no model was dropped into ios/Models/.
  private static func makeRequest() -> (VNRequest, String) {
    if let modelURL = firstCompiledModelURL() {
      do {
        let config = MLModelConfiguration()
        config.computeUnits = .all // Neural Engine / GPU when available
        let model = try MLModel(contentsOf: modelURL, configuration: config)
        let request = VNCoreMLRequest(model: try VNCoreMLModel(for: model))
        request.imageCropAndScaleOption = .scaleFill
        let name = modelURL.deletingPathExtension().lastPathComponent
        return (request, name)
      } catch {
        NSLog("[ArDetectors] failed to load model at %@: %@", modelURL.path, "\(error)")
      }
    }
    return (VNRecognizeAnimalsRequest(), "fallback: animals (no Core ML model bundled)")
  }

  // Find the first compiled Core ML model (.mlmodelc) across the bundles a static-framework pod might
  // place resources in. With `static_framework = true`, CocoaPods copies the ArDetectorsModels.bundle
  // into the APP's main bundle, while Bundle(for:) is the framework bundle — so we must check both,
  // and also scan each bundle directly in case the model wasn't namespaced into a sub-bundle.
  private static func firstCompiledModelURL() -> URL? {
    let bases = [Bundle(for: VisionObjectProcessor.self), Bundle.main]
    for base in bases {
      // Preferred: the podspec's resource_bundles → ArDetectorsModels.bundle.
      if let bundleURL = base.url(forResource: "ArDetectorsModels", withExtension: "bundle"),
        let bundle = Bundle(url: bundleURL),
        let url = (bundle.urls(forResourcesWithExtension: "mlmodelc", subdirectory: nil) ?? []).first {
        return url
      }
      // Fallback: a flat resource in the bundle itself.
      if let url = (base.urls(forResourcesWithExtension: "mlmodelc", subdirectory: nil) ?? []).first {
        return url
      }
    }
    return nil
  }

  func process(
    frame: ARFrame,
    viewportSize: CGSize,
    minConfidence: Double,
    raycast: @escaping (CGPoint) -> [String: Any],
    completion: @escaping ([[String: Any]]) -> Void
  ) {
    let buffer = frame.capturedImage // CVPixelBuffer, sensor-oriented (NOT display)

    queue.async {
      // .right matches the .portrait displayTransform above for a portrait-held device.
      let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .right)
      do {
        try handler.perform([self.request])
      } catch {
        NSLog("[ArDetectors] Vision request failed: %@", "\(error)")
        completion([])
        return
      }

      guard let observations = self.request.results as? [VNRecognizedObjectObservation] else {
        // Wrong model type (e.g. an image classifier) yields no boxes — log once so it's not a silent
        // empty stream.
        if !self.loggedResultMismatch, let results = self.request.results, !results.isEmpty {
          self.loggedResultMismatch = true
          NSLog(
            "[ArDetectors] model returned %@, not VNRecognizedObjectObservation — use an "
              + "object-detection model (boxes), not a classifier.",
            "\(type(of: results[0]))")
        }
        completion([])
        return
      }

      let dets: [[String: Any]] = observations
        .filter { Double($0.confidence) >= minConfidence }
        .map { obs in
          // Vision box: normalized 0–1, bottom-left origin, in the UPRIGHT portrait image (we passed
          // .right). Map it straight to a view-normalized, top-left rect — see viewRect(...) for why
          // we DON'T route through displayTransform.
          let viewRect = VisionObjectProcessor.viewRect(
            fromVisionBox: obs.boundingBox, buffer: buffer, viewportSize: viewportSize)
          // Box center in view points (top-left origin, no flip needed now).
          let centerPx = CGPoint(
            x: viewRect.midX * viewportSize.width,
            y: viewRect.midY * viewportSize.height)
          let hit = raycast(centerPx) // core primitive, SAME frame
          return [
            "id": UUID().uuidString,
            "label": obs.labels.first?.identifier ?? "object",
            "confidence": Double(obs.confidence),
            // Contract bbox is view-normalized, TOP-left origin — viewRect already is.
            "bbox": [
              "x": Double(viewRect.minX),
              "y": Double(viewRect.minY),
              "w": Double(viewRect.width),
              "h": Double(viewRect.height),
            ],
            "worldTransform": hit["worldTransform"] ?? NSNull(),
          ]
        }
      completion(dets)
    }
  }

  // Map a Vision bounding box (normalized 0–1, bottom-left origin, in the UPRIGHT portrait image you
  // get by passing `.right` to Vision) to a view-normalized rect (0–1, TOP-left origin) under
  // aspect-fill — the content mode ARSCNView/ARView use for the camera feed.
  //
  // We deliberately bypass ARFrame.displayTransform here. That transform expects coordinates in the
  // captured buffer's NATIVE sensor (landscape) space, but Vision has already re-oriented the box to
  // portrait — passing the upright box through displayTransform double-applies the landscape→portrait
  // rotation, which renders a wide object (e.g. a keyboard) as a tall, mis-placed box. Mapping
  // directly from the known portrait image dimensions is deterministic for the portrait-only
  // assumption this example documents.
  private static func viewRect(
    fromVisionBox b: CGRect,
    buffer: CVPixelBuffer,
    viewportSize view: CGSize
  ) -> CGRect {
    // capturedImage is landscape (sensor); the upright portrait image swaps the dimensions.
    let imageW = CGFloat(CVPixelBufferGetHeight(buffer))
    let imageH = CGFloat(CVPixelBufferGetWidth(buffer))
    guard imageW > 0, imageH > 0, view.width > 0, view.height > 0 else { return .zero }

    // Aspect-fill: scale to COVER the view, center the overflow (cropped, not letterboxed). max()
    // handles either binding dimension, so it's correct regardless of device/image aspect.
    let scale = max(view.width / imageW, view.height / imageH)
    let displayW = imageW * scale
    let displayH = imageH * scale
    let offsetX = (view.width - displayW) / 2
    let offsetY = (view.height - displayH) / 2

    // Vision y is bottom-up; the view is top-down → flip via (1 - maxY). Then image-points →
    // view-points → normalize to 0–1 of the view.
    let xPx = offsetX + b.minX * displayW
    let yPx = offsetY + (1 - b.maxY) * displayH
    let wPx = b.width * displayW
    let hPx = b.height * displayH

    return CGRect(
      x: xPx / view.width,
      y: yPx / view.height,
      width: wPx / view.width,
      height: hPx / view.height)
  }
}
