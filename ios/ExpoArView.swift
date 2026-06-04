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
  let onProjection = EventDispatcher()
  let onError = EventDispatcher()

  public let sceneView = ARSCNView(frame: .zero)
  public private(set) var anchorsById: [String: ARAnchor] = [:]
  // Swift Dictionary does NOT preserve insertion order, but a measuring tape connects
  // points in the order they were placed (1→2→3). We track that order explicitly so
  // serialize/projection emit anchors in placement order — matching Android's
  // LinkedHashMap, which already preserves insertion order (Swift/Kotlin parity).
  private var anchorOrder: [String] = []

  // Feature-layer render map (used by the placement feature). The CORE never reads or
  // writes this — removeAnchor/resetSession stay untouched, so the session/anchor logic
  // remains use-case-agnostic. Keyed by the same anchor id the core hands out.
  private var modelNodesById: [String: SCNNode] = [:]

  private var planeDetection: ARWorldTrackingConfiguration.PlaneDetection = [.horizontal, .vertical]
  private var depthEnabled = true
  // Opt-in per-frame projection of anchors → screen, gated to ~30fps. Off by default so
  // non-measurement screens pay nothing. lastProjectionEmit is in ARFrame.timestamp units.
  private var emitProjections = false
  private var lastProjectionEmit: TimeInterval = 0
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

  func setEmitProjections(_ on: Bool) {
    emitProjections = on
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
    anchorOrder.removeAll()
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

  // MARK: - Per-frame projection (opt-in via emitProjections)
  // Projects each anchor's world position to screen points so a 2D HUD can pin labels
  // that track in 3D. Throttled to ~30fps; skipped while not tracking or with <2 anchors.
  public func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard emitProjections, anchorsById.count >= 2 else { return }
    guard case .normal = frame.camera.trackingState else { return }
    if frame.timestamp - lastProjectionEmit < 1.0 / 30.0 { return }
    lastProjectionEmit = frame.timestamp

    let camInverse = simd_inverse(frame.camera.transform)
    let points: [[String: Any]] = orderedAnchorIds().map { id in
      let column = anchorsById[id]!.transform.columns.3
      return projected(id: id, worldX: column.x, worldY: column.y, worldZ: column.z,
                       camInverse: camInverse)
    }
    onProjection(["points": points])
  }

  private func orderedAnchorIds() -> [String] {
    anchorOrder.filter { anchorsById[$0] != nil }
  }

  // ARSCNView.projectPoint returns view-space points (top-left origin) — the same space
  // RN lays out in and that onTap reports, so no scale/flip is needed. inFront is derived
  // in camera space (ARKit cameras look down -z), which is robust for points behind you.
  private func projected(id: String, worldX: Float, worldY: Float, worldZ: Float,
                         camInverse: simd_float4x4) -> [String: Any] {
    let screen = sceneView.projectPoint(SCNVector3(worldX, worldY, worldZ))
    let local = camInverse * simd_float4(worldX, worldY, worldZ, 1)
    return [
      "id": id,
      "x": Double(screen.x),
      "y": Double(screen.y),
      "inFront": local.z < 0,
    ]
  }

  /// One-shot world→screen projection of a transform's translation. Returns nil when
  /// there's no current frame. id is empty (no owning anchor for an ad-hoc point).
  func worldToScreen(_ m: [Double]) -> [String: Any]? {
    guard m.count == 16, let frame = sceneView.session.currentFrame else { return nil }
    let camInverse = simd_inverse(frame.camera.transform)
    return projected(id: "", worldX: Float(m[12]), worldY: Float(m[13]), worldZ: Float(m[14]),
                     camInverse: camInverse)
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
    let id = anchor.identifier.uuidString
    anchorsById[id] = anchor
    anchorOrder.append(id)
    emitAnchors()
    return ["id": id]
  }

  func removeAnchor(id: String) {
    if let anchor = anchorsById.removeValue(forKey: id) {
      anchorOrder.removeAll { $0 == id }
      sceneView.session.remove(anchor: anchor)
      emitAnchors()
    }
  }

  func listAnchors() -> [[String: Any]] { orderedAnchors().map(serialize) }

  // Anchors in placement order (see anchorOrder). compactMap guards against any id that
  // somehow lost its dictionary entry.
  private func orderedAnchors() -> [ARAnchor] {
    anchorOrder.compactMap { anchorsById[$0] }
  }

  func snapshotBase64() -> String {
    sceneView.snapshot().jpegData(compressionQuality: 0.8)?.base64EncodedString() ?? ""
  }

  // MARK: - Additive rendering primitives (placement feature)
  // attachModel/detachModel are NEW methods — they don't alter the session/anchor core.
  // The placement hook calls attachModel after addAnchor, and detachModel BEFORE
  // removeAnchor/reset, so model nodes never outlive their anchors.

  /// Attach a renderable to an existing anchor, locked to its world pose. Loads a real
  /// USDZ/SCN when `uri` resolves to a loadable scene; otherwise renders a built-in
  /// primitive so the demo stays asset-free.
  func attachModel(_ id: String, _ uri: String) {
    guard let anchor = anchorsById[id] else { return }
    detachModel(id) // idempotent — replace any existing node for this anchor
    let node = loadModelNode(uri)
    node.simdTransform = anchor.transform
    sceneView.scene.rootNode.addChildNode(node)
    modelNodesById[id] = node
  }

  /// Remove a placed node. JS calls this alongside the core's removeAnchor.
  func detachModel(_ id: String) {
    modelNodesById.removeValue(forKey: id)?.removeFromParentNode()
  }

  private func loadModelNode(_ uri: String) -> SCNNode {
    // Real model load: SceneKit reads USDZ/SCN from a URL synchronously. Skip the
    // "builtin:" sentinel and anything that doesn't parse to a real URL → primitive.
    if !uri.hasPrefix("builtin:"), let url = URL(string: uri), url.scheme != nil,
      let scene = try? SCNScene(url: url, options: nil) {
      let container = SCNNode()
      scene.rootNode.childNodes.forEach { container.addChildNode($0) }
      return container
    }
    let box = SCNBox(width: 0.1, height: 0.1, length: 0.1, chamferRadius: 0.005)
    box.firstMaterial?.diffuse.contents = UIColor.systemTeal
    return SCNNode(geometry: box)
  }

  // MARK: - Anchor serialization (column-major 16-float transform — matches the contract)
  private func emitAnchors() {
    onAnchorsChange(["anchors": orderedAnchors().map(serialize)])
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
