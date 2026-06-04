import ARKit
import CoreLocation
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
  let onGeoStateChange = EventDispatcher()
  let onDetections = EventDispatcher()
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
  // CV-fusion extension: per-frame detection runs the registered processor named `detectionModel`.
  // Off by default (zero cost). The model is also skipped while a previous run is in flight, and
  // throttled to `detectionFps`. lastDetectionRun is in ARFrame.timestamp units.
  private var detectionEnabled = false
  private var detectionModel = ""
  private var minConfidence = 0.5
  private var detectionFps = 10.0
  private var detectionInFlight = false
  private var lastDetectionRun: TimeInterval = 0
  private var didReportReady = false
  // True only while the session is intentionally paused by JS, so foregrounding
  // doesn't silently resume a session the app asked to stop.
  private var pausedByUser = false

  // ---- Geospatial extension state ----
  // "world" (default) runs ARWorldTrackingConfiguration; "geo" runs ARGeoTrackingConfiguration.
  private var trackingMode = "world"
  // Core Location is required for geo tracking (authorization gate); retained so it isn't
  // deallocated mid-prompt.
  private let locationManager = CLLocationManager()
  private var geoState = "initializing"
  // ARKit reports a coarse ARGeoTrackingStatus.Accuracy (not meters); we cache it and map to
  // representative meter/degree values when building a GeospatialPose.
  private var lastGeoAccuracy: ARGeoTrackingStatus.Accuracy = .undetermined
  // Latest lat/long/altitude from getGeoLocation(forPoint:) (async), reused between refreshes.
  private var cachedGeoPose: [String: Any]?
  private var lastGeoEmit: TimeInterval = 0
  private var lastGeoLocationRequest: TimeInterval = 0
  private var pendingGeoLocation = false

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

  // CV-fusion extension props. None restart the session — detection layers on the frame hook.
  func setDetectionEnabled(_ on: Bool) { detectionEnabled = on }
  func setDetectionModel(_ name: String) { detectionModel = name }
  func setMinConfidence(_ value: Double) { minConfidence = value }
  func setDetectionFps(_ value: Double) { detectionFps = value }

  // Geospatial extension: switch the session configuration. Restarting is required — a
  // session runs exactly one configuration at a time. No-op if the mode is unchanged.
  func setTrackingMode(_ mode: String) {
    let normalized = (mode == "geo") ? "geo" : "world"
    guard normalized != trackingMode else { return }
    trackingMode = normalized
    geoState = "initializing"
    cachedGeoPose = nil
    runSession()
  }

  // MARK: - Session lifecycle
  private func runSession() {
    if trackingMode == "geo" {
      runGeoSession()
      return
    }
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

  // Geospatial extension: run ARGeoTrackingConfiguration (pure ARKit + Core Location). Falls
  // back to world tracking and reports onError when the device/region can't support geo.
  private func runGeoSession() {
    guard ARGeoTrackingConfiguration.isSupported else {
      onError(["code": "geo_unsupported", "message": "Geo tracking needs A12+ and GPS."])
      trackingMode = "world"
      runSession()
      return
    }
    // ARGeoTrackingConfiguration requires location authorization.
    locationManager.requestWhenInUseAuthorization()
    let config = ARGeoTrackingConfiguration()
    config.planeDetection = planeDetection
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
          "geoTrackingSupported": ARGeoTrackingConfiguration.isSupported,
        ]
      ])
    }
  }

  public func session(_ session: ARSession, didFailWithError error: Error) {
    onError(["code": "session_failed", "message": error.localizedDescription])
  }

  // MARK: - Geospatial tracking state (ARSessionDelegate)
  // Drives onGeoStateChange on geo-tracking transitions; the per-frame loop emits throttled
  // pose updates. Accuracy is cached here (ARKit reports a coarse enum, not meters).
  public func session(_ session: ARSession, didChange geoTrackingStatus: ARGeoTrackingStatus) {
    lastGeoAccuracy = geoTrackingStatus.accuracy
    switch geoTrackingStatus.state {
    case .notAvailable: geoState = "unavailable"
    case .initializing: geoState = "initializing"
    case .localizing: geoState = "localizing"
    case .localized: geoState = "localized"
    @unknown default: geoState = "unavailable"
    }
    onGeoStateChange(["state": geoState, "pose": cachedGeoPose ?? NSNull()])
  }

  // MARK: - Per-frame projection (opt-in via emitProjections)
  // Projects each anchor's world position to screen points so a 2D HUD can pin labels
  // that track in 3D. Throttled to ~30fps; skipped while not tracking or with <2 anchors.
  public func session(_ session: ARSession, didUpdate frame: ARFrame) {
    emitGeoIfNeeded(frame)
    runDetectionIfNeeded(frame)
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

  // MARK: - CV-fusion detection (opt-in via detectionEnabled + a registered detectionModel)
  // Runs the registered processor on the throttled cadence, skipping while a previous inference is
  // in flight (so we never block the delegate thread or pile up requests). The processor does the
  // inference + sensor→view box mapping + same-frame raycast; we only own the scaffold and emit.
  private func runDetectionIfNeeded(_ frame: ARFrame) {
    guard detectionEnabled, !detectionInFlight,
      case .normal = frame.camera.trackingState,
      let processor = ExpoArDetectorRegistry.processor(for: detectionModel)
    else { return }
    if frame.timestamp - lastDetectionRun < 1.0 / max(detectionFps, 1) { return }
    lastDetectionRun = frame.timestamp
    detectionInFlight = true

    let viewport = bounds.size
    processor.process(
      frame: frame, viewportSize: viewport, minConfidence: minConfidence,
      raycast: { [weak self] point in
        self?.raycast(at: point) ?? ["worldTransform": NSNull(), "target": NSNull()]
      }
    ) { [weak self] detections in
      guard let self = self else { return }
      DispatchQueue.main.async {
        self.onDetections(["detections": detections])
        self.detectionInFlight = false
      }
    }
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
    return ["id": registerAnchor(ARAnchor(transform: result.worldTransform))]
  }

  /// CV-fusion extension: anchor directly at a world transform the detector already computed —
  /// a sibling of addAnchor(at:) that skips the raycast. `m` is the 16-float column-major transform.
  func addAnchorAtWorld(_ m: [Double]) -> [String: Any]? {
    guard m.count == 16 else {
      onError(["code": "bad_transform", "message": "Expected a 16-element column-major transform."])
      return nil
    }
    let f = m.map { Float($0) }
    let transform = simd_float4x4(
      simd_float4(f[0], f[1], f[2], f[3]),
      simd_float4(f[4], f[5], f[6], f[7]),
      simd_float4(f[8], f[9], f[10], f[11]),
      simd_float4(f[12], f[13], f[14], f[15]))
    return ["id": registerAnchor(ARAnchor(transform: transform))]
  }

  // Shared anchor-registration tail (add to session + bookkeeping + emit) used by addAnchor,
  // addAnchorAtWorld, and addGeoAnchor so all three stay in sync.
  @discardableResult
  private func registerAnchor(_ anchor: ARAnchor) -> String {
    sceneView.session.add(anchor: anchor)
    let id = anchor.identifier.uuidString
    anchorsById[id] = anchor
    anchorOrder.append(id)
    emitAnchors()
    return id
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

  // MARK: - Geospatial extension (active only while trackingMode is "geo")

  // Per-frame: refresh the cached lat/long/altitude (getGeoLocation is async) and emit a
  // throttled onGeoStateChange so JS sees a steady pose/accuracy stream (matches Android's
  // earth-pose stream). No-op outside geo mode.
  private func emitGeoIfNeeded(_ frame: ARFrame) {
    guard trackingMode == "geo" else { return }
    let now = frame.timestamp

    if now - lastGeoLocationRequest > 1.0, !pendingGeoLocation,
      case .normal = frame.camera.trackingState
    {
      pendingGeoLocation = true
      lastGeoLocationRequest = now
      let cam = frame.camera.transform.columns.3
      sceneView.session.getGeoLocation(forPoint: simd_float3(cam.x, cam.y, cam.z)) {
        [weak self] coord, altitude, error in
        guard let self = self else { return }
        self.pendingGeoLocation = false
        if error == nil {
          self.cachedGeoPose = self.geoPoseDict(coord: coord, altitude: altitude)
        }
      }
    }

    if now - lastGeoEmit < 0.5 { return }
    lastGeoEmit = now
    onGeoStateChange(["state": geoState, "pose": cachedGeoPose ?? NSNull()])
  }

  /// VPS coverage check at a coordinate — resolve "available"|"unavailable"|"unknown".
  func checkVpsAvailability(_ lat: Double, _ lng: Double, _ resolve: @escaping (String) -> Void) {
    guard ARGeoTrackingConfiguration.isSupported else {
      resolve("unavailable")
      return
    }
    let coord = CLLocationCoordinate2D(latitude: lat, longitude: lng)
    ARGeoTrackingConfiguration.checkAvailability(at: coord) { available, error in
      if error != nil {
        resolve("unknown")
      } else {
        resolve(available ? "available" : "unavailable")
      }
    }
  }

  /// Create an ARGeoAnchor at a real coordinate; emits onAnchorsChange (type "geo"). `alt` nil
  /// → ground level. `heading` from the contract is unused on iOS (ARGeoAnchor has no heading).
  func addGeoAnchor(_ lat: Double, _ lng: Double, _ alt: Double?) -> [String: Any]? {
    guard trackingMode == "geo", ARGeoTrackingConfiguration.isSupported else {
      onError(["code": "not_geo", "message": "Geo tracking is not active."])
      return nil
    }
    let coord = CLLocationCoordinate2D(latitude: lat, longitude: lng)
    let anchor: ARGeoAnchor =
      alt != nil ? ARGeoAnchor(coordinate: coord, altitude: alt!) : ARGeoAnchor(coordinate: coord)
    return ["id": registerAnchor(anchor)]
  }

  /// One-shot current device geospatial pose, or nil if not yet localizable.
  func getGeospatialPose(_ resolve: @escaping ([String: Any]?) -> Void) {
    guard trackingMode == "geo", let frame = sceneView.session.currentFrame else {
      resolve(nil)
      return
    }
    let cam = frame.camera.transform.columns.3
    sceneView.session.getGeoLocation(forPoint: simd_float3(cam.x, cam.y, cam.z)) {
      [weak self] coord, altitude, error in
      guard let self = self, error == nil else {
        resolve(nil)
        return
      }
      resolve(self.geoPoseDict(coord: coord, altitude: altitude))
    }
  }

  private func geoPoseDict(coord: CLLocationCoordinate2D, altitude: CLLocationDistance)
    -> [String: Any]
  {
    let (h, v, head) = geoAccuracyMeters()
    return [
      "latitude": coord.latitude,
      "longitude": coord.longitude,
      "altitude": altitude,
      "horizontalAccuracy": h,
      "verticalAccuracy": v,
      "headingAccuracy": head,
    ]
  }

  // ARKit exposes only a coarse ARGeoTrackingStatus.Accuracy, not meters like ARCore. Map to
  // representative (horizontal, vertical, heading) values so the contract's numeric accuracy
  // fields are populated; treat these as approximate on iOS.
  private func geoAccuracyMeters() -> (Double, Double, Double) {
    switch lastGeoAccuracy {
    case .high: return (1.0, 1.5, 8.0)
    case .medium: return (5.0, 8.0, 20.0)
    case .low: return (25.0, 40.0, 45.0)
    default: return (9999.0, 9999.0, 180.0)
    }
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
    let type: String
    if anchor is ARGeoAnchor {
      type = "geo"
    } else if anchor is ARPlaneAnchor {
      type = "plane"
    } else {
      type = "point"
    }
    return [
      "id": anchor.identifier.uuidString,
      "transform": flatten(anchor.transform),
      "type": type,
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
