import ARKit
import ExpoModulesCore
import SceneKit

// Generic ARKit AR view. Owns the camera + world-anchored 3D content; React Native
// draws its 2D HUD on top. `open` + public `sceneView`/`anchorsById` so feature code
// (measurement, placement) can subclass and attach nodes on onAnchorsChange.
open class ExpoArView: ExpoView, ARSCNViewDelegate, ARSessionDelegate {
  // Event dispatchers — names MUST match Events(...) in ExpoArModule and the Kotlin side.
  let onReady = EventDispatcher()
  let onTrackingStateChange = EventDispatcher()
  let onTap = EventDispatcher()
  let onAnchorsChange = EventDispatcher()
  let onError = EventDispatcher()

  public let sceneView = ARSCNView(frame: .zero)
  public private(set) var anchorsById: [String: ARAnchor] = [:]

  private var planeDetection: ARWorldTrackingConfiguration.PlaneDetection = [.horizontal, .vertical]
  private var depthEnabled = true
  private var didReportReady = false
  // True only while the session is intentionally paused by JS, so foregrounding
  // doesn't silently resume a session the app asked to stop.
  private var pausedByUser = false

  required public init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    sceneView.delegate = self
    sceneView.session.delegate = self
    sceneView.automaticallyUpdatesLighting = true
    addSubview(sceneView)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    sceneView.addGestureRecognizer(tap)

    // Session lifecycle discipline: a running ARSession holds the camera + motion
    // sensors. Pause on background/blur, resume on foreground — leaving it running
    // drains battery and can crash on re-entry.
    NotificationCenter.default.addObserver(
      self, selector: #selector(appWillResignActive),
      name: UIApplication.willResignActiveNotification, object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(appDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification, object: nil)

    runSession()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    sceneView.session.pause()
  }

  open override func layoutSubviews() {
    super.layoutSubviews()
    sceneView.frame = bounds
  }

  // Pause when detached from the window hierarchy (e.g. screen navigated away),
  // resume when re-attached — unless JS explicitly paused us.
  open override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      sceneView.session.pause()
    } else if !pausedByUser {
      runSession()
    }
  }

  @objc private func appWillResignActive() { sceneView.session.pause() }
  @objc private func appDidBecomeActive() {
    if window != nil && !pausedByUser { runSession() }
  }

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

  func setDepthEnabled(_ on: Bool) {
    depthEnabled = on
    runSession()
  }

  func setDebug(_ on: Bool) {
    sceneView.debugOptions = on ? [.showFeaturePoints, .showWorldOrigin] : []
  }

  // MARK: - Session lifecycle
  private func runSession() {
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = planeDetection
    config.environmentTexturing = .automatic
    // depthEnabled → LiDAR scene reconstruction, gated on hardware support so it
    // degrades cleanly on non-LiDAR devices.
    if depthEnabled,
      ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification)
    {
      config.sceneReconstruction = .meshWithClassification
    }
    pausedByUser = false
    sceneView.session.run(config)
  }

  func pauseSession() {
    pausedByUser = true
    sceneView.session.pause()
  }

  func resumeSession() { runSession() }

  func resetSession() {
    anchorsById.removeAll()
    let config = sceneView.session.configuration ?? ARWorldTrackingConfiguration()
    sceneView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    emitAnchors()
  }

  // MARK: - Tracking state (ARSessionDelegate)
  public func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    let state: String
    switch camera.trackingState {
    case .normal: state = "normal"
    case .limited: state = "limited"
    case .notAvailable: state = "unavailable"
    }
    onTrackingStateChange(["state": state])
    // onReady fires once, on the first time tracking reaches `normal` — this is the
    // "blank tracking view is live" signal, carrying the resolved capabilities.
    if !didReportReady, case .normal = camera.trackingState {
      didReportReady = true
      onReady([
        "capabilities": [
          "arSupported": true,
          "depthOrLidarAvailable":
            ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh),
        ]
      ])
    }
  }

  public func session(_ session: ARSession, didFailWithError error: Error) {
    onError(["code": "session_failed", "message": error.localizedDescription])
  }

  // MARK: - Tap forwarding (features may raycast/addAnchor in JS on tap)
  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    let point = gesture.location(in: sceneView)
    onTap(["x": point.x, "y": point.y])
  }

  // MARK: - Generic primitives
  /// Screen point → world transform. With LiDAR mesh on, `.estimatedPlane` resolves
  /// against real geometry; without it, results lean on feature points/planes.
  func raycast(at point: CGPoint) -> [String: Any] {
    guard
      let query = sceneView.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .any),
      let result = sceneView.session.raycast(query).first
    else {
      return ["worldTransform": NSNull(), "target": NSNull()]
    }
    return [
      "worldTransform": flatten(result.worldTransform),
      "target": targetString(result.target),
    ]
  }

  /// Raycast + create a persistent anchor; emits onAnchorsChange.
  func addAnchor(at point: CGPoint) -> [String: Any]? {
    guard
      let query = sceneView.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .any),
      let result = sceneView.session.raycast(query).first
    else {
      onError(["code": "no_hit", "message": "No surface found at point."])
      return nil
    }
    let anchor = ARAnchor(transform: result.worldTransform)
    sceneView.session.add(anchor: anchor)
    anchorsById[anchor.identifier.uuidString] = anchor
    emitAnchors()
    return ["id": anchor.identifier.uuidString]
  }

  func removeAnchor(id: String) {
    if let anchor = anchorsById.removeValue(forKey: id) {
      sceneView.session.remove(anchor: anchor)
      emitAnchors()
    }
  }

  func listAnchors() -> [[String: Any]] { anchorsById.values.map(serialize) }

  func snapshotBase64() -> String {
    sceneView.snapshot().jpegData(compressionQuality: 0.8)?.base64EncodedString() ?? ""
  }

  // MARK: - Anchor serialization (column-major 16-float transform — matches the contract)
  private func emitAnchors() {
    onAnchorsChange(["anchors": anchorsById.values.map(serialize)])
  }

  private func serialize(_ anchor: ARAnchor) -> [String: Any] {
    [
      "id": anchor.identifier.uuidString,
      "transform": flatten(anchor.transform),
      "type": (anchor is ARPlaneAnchor) ? "plane" : "point",
    ]
  }

  // simd_float4x4 stores columns directly, so listing column.x/y/z/w in order yields
  // the column-major 16-float array the contract (and Pose.toMatrix on Android) expects.
  private func flatten(_ m: simd_float4x4) -> [Float] {
    [
      m.columns.0.x, m.columns.0.y, m.columns.0.z, m.columns.0.w,
      m.columns.1.x, m.columns.1.y, m.columns.1.z, m.columns.1.w,
      m.columns.2.x, m.columns.2.y, m.columns.2.z, m.columns.2.w,
      m.columns.3.x, m.columns.3.y, m.columns.3.z, m.columns.3.w,
    ]
  }

  private func targetString(_ target: ARRaycastQuery.Target) -> String {
    switch target {
    case .estimatedPlane: return depthEnabled ? "mesh" : "feature"
    case .existingPlaneGeometry, .existingPlaneInfinite: return "plane"
    @unknown default: return "feature"
    }
  }
}
