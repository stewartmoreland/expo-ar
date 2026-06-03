# iOS — generic ARKit core

The use-case-agnostic ARKit side of `expo-ar`: session, lifecycle, tracking, the raycast primitive, anchor management, plane detection, LiDAR mesh, frame-buffer access, snapshot. Features (measurement, placement) extend this view rather than replace it. Files under `modules/expo-ar/ios/`.

Rendering choice: `ARSCNView` (SceneKit) is used because adding/removing world-anchored content nodes is straightforward. If you need real occlusion of virtual content behind physical objects, switch the base to `ARView` (RealityKit) and `arView.environment.sceneUnderstanding.options.insert(.occlusion)` — the primitives below map across both.

## Module — `ExpoArModule.swift`

```swift
import ExpoModulesCore
import ARKit

public class ExpoArModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAr")

    // Callable before any view mounts — lets JS branch to the expo-camera fallback.
    Function("getCapabilities") { () -> [String: Any] in
      [
        "arSupported": ARWorldTrackingConfiguration.isSupported,
        "depthOrLidarAvailable": ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh),
      ]
    }

    View(ExpoArView.self) {
      Events("onReady", "onTrackingStateChange", "onTap", "onAnchorsChange", "onError")

      Prop("planeDetection") { (v: ExpoArView, mode: String) in v.setPlaneDetection(mode) }
      Prop("depthEnabled")   { (v: ExpoArView, on: Bool)     in v.setDepthEnabled(on) }
      Prop("debug")          { (v: ExpoArView, on: Bool)     in v.setDebug(on) }

      // Generic primitives — features compose these.
      AsyncFunction("raycast") { (v: ExpoArView, x: Double, y: Double) -> [String: Any] in
        v.raycast(at: CGPoint(x: x, y: y))
      }
      AsyncFunction("addAnchor") { (v: ExpoArView, x: Double, y: Double) -> [String: Any]? in
        v.addAnchor(at: CGPoint(x: x, y: y))
      }
      AsyncFunction("removeAnchor") { (v: ExpoArView, id: String) in v.removeAnchor(id: id) }
      AsyncFunction("listAnchors")  { (v: ExpoArView) -> [[String: Any]] in v.listAnchors() }
      AsyncFunction("pause")  { (v: ExpoArView) in v.pauseSession() }
      AsyncFunction("resume") { (v: ExpoArView) in v.resumeSession() }
      AsyncFunction("reset")  { (v: ExpoArView) in v.resetSession() }
      AsyncFunction("snapshot") { (v: ExpoArView) -> String in v.snapshotBase64() }
    }
  }
}
```

## View — `ExpoArView.swift`

```swift
import ExpoModulesCore
import ARKit
import SceneKit

open class ExpoArView: ExpoView, ARSCNViewDelegate, ARSessionDelegate {
  // Event dispatchers — names MUST match the contract.
  let onReady = EventDispatcher()
  let onTrackingStateChange = EventDispatcher()
  let onTap = EventDispatcher()
  let onAnchorsChange = EventDispatcher()
  let onError = EventDispatcher()

  // Exposed to feature subclasses/extensions.
  public let sceneView = ARSCNView(frame: .zero)
  public private(set) var anchorsById: [String: ARAnchor] = [:]

  private var planeDetection: ARWorldTrackingConfiguration.PlaneDetection = [.horizontal, .vertical]
  private var depthEnabled = true
  private var didReportReady = false

  required public init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    sceneView.delegate = self
    sceneView.session.delegate = self
    sceneView.automaticallyUpdatesLighting = true
    addSubview(sceneView)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    sceneView.addGestureRecognizer(tap)
    runSession()
  }

  open override func layoutSubviews() { super.layoutSubviews(); sceneView.frame = bounds }

  // MARK: - Props
  func setPlaneDetection(_ mode: String) {
    switch mode {
    case "none": planeDetection = []
    case "horizontal": planeDetection = [.horizontal]
    case "vertical": planeDetection = [.vertical]
    default: planeDetection = [.horizontal, .vertical]
    }
    runSession()
  }
  func setDepthEnabled(_ on: Bool) { depthEnabled = on; runSession() }
  func setDebug(_ on: Bool) {
    sceneView.debugOptions = on ? [.showFeaturePoints, .showWorldOrigin] : []
  }

  // MARK: - Session lifecycle
  private func runSession() {
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = planeDetection
    config.environmentTexturing = .automatic
    if depthEnabled,
       ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
      config.sceneReconstruction = .meshWithClassification
    }
    sceneView.session.run(config)
  }
  func pauseSession()  { sceneView.session.pause() }
  func resumeSession() { runSession() }
  func resetSession() {
    anchorsById.removeAll()
    let config = sceneView.session.configuration ?? ARWorldTrackingConfiguration()
    sceneView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    emitAnchors()
  }

  // MARK: - Tracking state
  public func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    let state: String
    switch camera.trackingState {
    case .normal: state = "normal"
    case .limited: state = "limited"
    case .notAvailable: state = "unavailable"
    }
    onTrackingStateChange(["state": state])
    if !didReportReady, case .normal = camera.trackingState {
      didReportReady = true
      onReady(["capabilities": [
        "arSupported": true,
        "depthOrLidarAvailable": ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh),
      ]])
    }
  }

  // MARK: - Tap forwarding (features may raycast/addAnchor in JS on tap)
  @objc private func handleTap(_ g: UITapGestureRecognizer) {
    let p = g.location(in: sceneView)
    onTap(["x": p.x, "y": p.y])
  }

  // MARK: - Generic primitives
  /// Screen point -> world. With LiDAR mesh on, `.estimatedPlane` resolves against real geometry.
  func raycast(at p: CGPoint) -> [String: Any] {
    guard let query = sceneView.raycastQuery(from: p, allowing: .estimatedPlane, alignment: .any),
          let r = sceneView.session.raycast(query).first else {
      return ["worldTransform": NSNull(), "target": NSNull()]
    }
    return ["worldTransform": flatten(r.worldTransform), "target": targetString(r.target)]
  }

  /// Raycast + create a persistent anchor; emits onAnchorsChange.
  func addAnchor(at p: CGPoint) -> [String: Any]? {
    guard let query = sceneView.raycastQuery(from: p, allowing: .estimatedPlane, alignment: .any),
          let r = sceneView.session.raycast(query).first else {
      onError(["code": "no_hit", "message": "No surface found at point."]); return nil
    }
    let anchor = ARAnchor(transform: r.worldTransform)
    sceneView.session.add(anchor: anchor)
    anchorsById[anchor.identifier.uuidString] = anchor
    emitAnchors()
    return ["id": anchor.identifier.uuidString]
  }

  func removeAnchor(id: String) {
    if let a = anchorsById.removeValue(forKey: id) { sceneView.session.remove(anchor: a); emitAnchors() }
  }
  func listAnchors() -> [[String: Any]] { anchorsById.values.map(serialize) }

  func snapshotBase64() -> String {
    sceneView.snapshot().jpegData(compressionQuality: 0.8)?.base64EncodedString() ?? ""
  }

  // MARK: - Anchor serialization (column-major 16-float transform — matches the contract)
  private func emitAnchors() { onAnchorsChange(["anchors": anchorsById.values.map(serialize)]) }
  private func serialize(_ a: ARAnchor) -> [String: Any] {
    ["id": a.identifier.uuidString, "transform": flatten(a.transform),
     "type": (a is ARPlaneAnchor) ? "plane" : "point"]
  }
  private func flatten(_ m: simd_float4x4) -> [Float] {
    [m.columns.0.x, m.columns.0.y, m.columns.0.z, m.columns.0.w,
     m.columns.1.x, m.columns.1.y, m.columns.1.z, m.columns.1.w,
     m.columns.2.x, m.columns.2.y, m.columns.2.z, m.columns.2.w,
     m.columns.3.x, m.columns.3.y, m.columns.3.z, m.columns.3.w]
  }
  private func targetString(_ t: ARRaycastQuery.Target) -> String {
    switch t {
    case .estimatedPlane: return depthEnabled ? "mesh" : "feature"
    case .existingPlaneGeometry, .existingPlaneInfinite: return "plane"
    @unknown default: return "feature"
    }
  }
}
```

## Frame buffer access (for fusing on-device CV)

ARKit hands you each frame's pixel buffer, so you can run Vision / Core ML *inside* the AR module instead of bridging frames out. In the session delegate:

```swift
public func session(_ session: ARSession, didUpdate frame: ARFrame) {
  let pixelBuffer = frame.capturedImage   // CVPixelBuffer — feed to a VNImageRequestHandler / Core ML
  // Run detection, then raycast the result's screen center to get a world transform,
  // emit your own event. Keep this on a background queue; throttle to avoid stalls.
}
```

This is the basis for detect-then-place / detect-then-measure features without a separate camera library.

## Notes & gotchas

- **`open class` + `public sceneView`/`anchorsById`** so feature code can extend the view and add nodes (e.g. a measurement subclass that draws lines on `onAnchorsChange`).
- **`NSNull()` for null** is what makes JS receive `null` for a missed raycast (matching the Zod `.nullable()`).
- **Raycast targeting**: `.estimatedPlane` is general-purpose; with `sceneReconstruction` on, ARKit resolves it against the LiDAR mesh (accurate on objects/untextured walls). Without LiDAR, results lean on feature points/planes — needs textured, lit surfaces.
- **Lifecycle**: pause from JS on screen blur; ARKit also auto-pauses on backgrounding, but explicit `pause()` avoids battery drain during in-app navigation.
- **Info.plist** needs `NSCameraUsageDescription` (config plugin adds it).
