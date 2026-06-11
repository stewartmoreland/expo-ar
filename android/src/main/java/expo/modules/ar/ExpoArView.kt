package expo.modules.ar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.view.MotionEvent
import android.view.PixelCopy
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.findViewTreeLifecycleOwner
import com.google.ar.core.Anchor
import com.google.ar.core.Config
import com.google.ar.core.DepthPoint
import com.google.ar.core.Earth
import com.google.ar.core.Frame
import com.google.ar.core.GeospatialPose
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.Pose
import com.google.ar.core.Trackable
import com.google.ar.core.TrackingState
import com.google.ar.core.VpsAvailability
import dev.romainguy.kotlin.math.Float3
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import io.github.sceneview.ar.ARSceneView
import io.github.sceneview.ar.node.AnchorNode
import io.github.sceneview.gesture.GestureDetector
import io.github.sceneview.node.CubeNode
import io.github.sceneview.node.ModelNode
import io.github.sceneview.node.Node
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.sqrt

// Generic ARCore AR view. Owns the camera + world-anchored 3D content; React Native
// draws its 2D HUD on top. `open` + exposed sceneView/anchorsById so feature code
// (measurement, placement) can subclass and attach nodes on onAnchorsChange.
//
// The view IS its own LifecycleOwner: ARSceneView 2.3.0 drives session resume/pause
// off a Lifecycle (you do NOT call onResume/onPause on it directly). We gate that
// lifecycle on (attached-to-window AND host-foreground AND not JS-paused) so the
// ARCore session releases the camera on screen blur / app background.
open class ExpoArView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), LifecycleOwner {

  private val onReady by EventDispatcher()
  private val onTrackingStateChange by EventDispatcher()
  private val onTap by EventDispatcher()
  private val onAnchorsChange by EventDispatcher()
  private val onProjection by EventDispatcher()
  private val onGeoStateChange by EventDispatcher()
  private val onDetections by EventDispatcher()
  private val onError by EventDispatcher()

  val sceneView = ARSceneView(context)
  protected val anchorsById = mutableMapOf<String, Anchor>()
  // Geospatial extension: ids of anchors created via addGeoAnchor, so serialize() can tag them
  // type "geo". (anchorsById holds plain Anchors regardless of how they were created.)
  private val geoAnchorIds = mutableSetOf<String>()

  // Feature-layer render map (used by the placement feature). The CORE never reads or
  // writes this — removeAnchor/resetSession stay untouched, so the session/anchor logic
  // remains use-case-agnostic. Keyed by the same anchor id the core hands out.
  private val modelNodesById = mutableMapOf<String, AnchorNode>()

  private var planeMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
  private var depthEnabled = true
  private var depthAvailable = false
  private var didReportReady = false
  private var lastState: TrackingState? = null
  private var anchorCounter = 0
  // Opt-in per-frame projection of anchors → screen, gated to ~30fps. Off by default so
  // non-measurement screens pay nothing. lastProjectionEmit is in Frame.timestamp nanos.
  private var emitProjections = false
  private var lastProjectionEmit = 0L
  // Geospatial extension: "world" (default) | "geo". lastGeoEmit throttles onGeoStateChange.
  private var trackingMode = "world"
  private var lastGeoEmit = 0L
  // CV-fusion extension: per-frame detection runs the registered processor named `detectionModel`.
  // Off by default (zero cost). Skipped while a previous run is in flight, and throttled to
  // `detectionFps`. lastDetectionRun is in Frame.timestamp nanos.
  private var detectionEnabled = false
  private var detectionModel = ""
  private var minConfidence = 0.5
  private var detectionFps = 10.0
  private var detectionInFlight = false
  private var lastDetectionRun = 0L

  // ---- Lifecycle plumbing (see class doc) ----
  private val lifecycleRegistry = LifecycleRegistry(this)
  override val lifecycle: Lifecycle get() = lifecycleRegistry
  private var attached = false
  private var hostForeground = true
  private var pausedByUser = false
  private var destroyed = false
  private var hostLifecycle: Lifecycle? = null
  private val hostObserver = object : DefaultLifecycleObserver {
    override fun onResume(owner: LifecycleOwner) { hostForeground = true; syncLifecycle() }
    override fun onPause(owner: LifecycleOwner) { hostForeground = false; syncLifecycle() }
    override fun onDestroy(owner: LifecycleOwner) { destroyed = true; syncLifecycle() }
  }

  init {
    addView(sceneView)
    // ARSceneView observes this Lifecycle and self-manages the ARCore session +
    // Play-Services-for-AR install flow.
    sceneView.lifecycle = lifecycleRegistry
    configure()
    sceneView.onSessionUpdated = { _, frame -> onFrame(frame) }
    // 2.3.0: gestures are a property of type GestureDetector.OnGestureListener — there
    // is no setOnGestureListener(onSingleTapConfirmed = …) helper (that was older API).
    sceneView.onGestureListener = object : GestureDetector.SimpleOnGestureListener() {
      override fun onSingleTapConfirmed(e: MotionEvent, node: Node?) {
        // MotionEvent is in physical pixels; emit RN logical dp so onTap/raycast/projection
        // all speak the SAME coordinate space as iOS points (and useWindowDimensions dp).
        val density = resources.displayMetrics.density
        onTap(mapOf("x" to e.x / density, "y" to e.y / density))
      }
    }
    // Session-level failures (install/update declined, camera unavailable, ARCore error)
    // surface to JS as onError — same code/keys as iOS session(_:didFailWithError:), so a
    // consumer can show the expo-camera fallback on either platform with identical handling.
    sceneView.onSessionFailed = { error ->
      onError(mapOf("code" to "session_failed", "message" to (error.message ?: error.toString())))
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    hostLifecycle = (findViewTreeLifecycleOwner() ?: (context as? LifecycleOwner))?.lifecycle
    hostLifecycle?.let {
      hostForeground = it.currentState.isAtLeast(Lifecycle.State.RESUMED)
      it.addObserver(hostObserver)
    }
    syncLifecycle()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    attached = false
    hostLifecycle?.removeObserver(hostObserver)
    hostLifecycle = null
    syncLifecycle()
  }

  // Drive the ARSceneView's session: RESUMED only when on-screen, foregrounded, and
  // not explicitly paused by JS; otherwise CREATED (paused) — or DESTROYED on teardown.
  private fun syncLifecycle() {
    lifecycleRegistry.currentState = when {
      destroyed -> Lifecycle.State.DESTROYED
      attached && hostForeground && !pausedByUser -> Lifecycle.State.RESUMED
      else -> Lifecycle.State.CREATED
    }
  }

  // Reapplies config to the live session (configureSession also re-applies on change).
  private fun configure() {
    sceneView.configureSession { session, config ->
      depthAvailable = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
      // Depth is opt-in: without AUTOMATIC there are no DepthPoint hits and accuracy
      // collapses on objects. Gated on support so it degrades cleanly.
      config.depthMode =
        if (depthEnabled && depthAvailable) Config.DepthMode.AUTOMATIC
        else Config.DepthMode.DISABLED
      config.planeFindingMode = planeMode
      config.lightEstimationMode = Config.LightEstimationMode.ENVIRONMENTAL_HDR
      // Geospatial extension: enable Earth/VPS tracking only in geo mode, gated on support so
      // it degrades cleanly. Requires ACCESS_FINE_LOCATION granted + a Cloud ARCore API key.
      config.geospatialMode =
        if (trackingMode == "geo" &&
          session.isGeospatialModeSupported(Config.GeospatialMode.ENABLED)
        ) {
          Config.GeospatialMode.ENABLED
        } else {
          Config.GeospatialMode.DISABLED
        }
    }
  }

  // MARK: - Props
  fun setPlaneDetection(mode: String) {
    planeMode = when (mode) {
      "none" -> Config.PlaneFindingMode.DISABLED
      "horizontal" -> Config.PlaneFindingMode.HORIZONTAL
      "vertical" -> Config.PlaneFindingMode.VERTICAL
      else -> Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
    }
    configure()
  }

  fun setDepthEnabled(on: Boolean) {
    depthEnabled = on
    configure()
  }

  fun setDebug(on: Boolean) {
    sceneView.planeRenderer.isEnabled = on
  }

  fun setEmitProjections(on: Boolean) {
    emitProjections = on
  }

  // CV-fusion extension props. None reconfigure the session — detection layers on the frame hook.
  fun setDetectionEnabled(on: Boolean) { detectionEnabled = on }
  fun setDetectionModel(name: String) { detectionModel = name }
  fun setMinConfidence(value: Double) { minConfidence = value }
  fun setDetectionFps(value: Double) { detectionFps = value }

  // Geospatial extension: switch the session configuration (reconfigured in place). No-op if
  // the mode is unchanged.
  fun setTrackingMode(mode: String) {
    val normalized = if (mode == "geo") "geo" else "world"
    if (normalized == trackingMode) return
    trackingMode = normalized
    configure()
  }

  // MARK: - Session lifecycle (JS-driven, on screen blur/focus)
  fun pauseSession() {
    pausedByUser = true
    syncLifecycle()
  }

  fun resumeSession() {
    pausedByUser = false
    syncLifecycle()
  }

  fun resetSession() {
    anchorsById.values.forEach { it.detach() }
    anchorsById.clear()
    geoAnchorIds.clear()
    emitAnchors()
    configure()
  }

  private fun onFrame(frame: Frame) {
    val state = frame.camera.trackingState
    if (state != lastState) {
      lastState = state
      onTrackingStateChange(mapOf("state" to state.toContract()))
      // onReady fires once, on the first TRACKING frame — the "blank tracking view
      // is live" signal, carrying the resolved capabilities. Mirrors iOS onReady.
      if (!didReportReady && state == TrackingState.TRACKING) {
        didReportReady = true
        onReady(
          mapOf(
            "capabilities" to mapOf(
              "arSupported" to true,
              "depthOrLidarAvailable" to depthAvailable,
              "geoTrackingSupported" to
                (sceneView.session?.isGeospatialModeSupported(Config.GeospatialMode.ENABLED)
                  ?: false),
            )
          )
        )
      }
    }
    emitProjectionsIfNeeded(frame)
    emitGeoIfNeeded(frame)
    runDetectionIfNeeded(frame)
  }

  // MARK: - CV-fusion detection (opt-in via detectionEnabled + a registered detectionModel)
  // Runs the registered processor on the throttled cadence, skipping while a previous inference is
  // in flight (so we never block the session-update thread or pile up requests). The processor owns
  // the inference, the IMAGE→VIEW box mapping, the same-frame raycast, and closing the camera image;
  // we own only the scaffold and the emit.
  private fun runDetectionIfNeeded(frame: Frame) {
    if (!detectionEnabled || detectionInFlight) return
    if (frame.camera.trackingState != TrackingState.TRACKING) return
    val processor = ExpoArDetectorRegistry.processor(detectionModel) ?: return
    val now = frame.timestamp
    val interval = (1_000_000_000.0 / maxOf(detectionFps, 1.0)).toLong()
    if (now - lastDetectionRun < interval) return
    lastDetectionRun = now
    detectionInFlight = true
    // The processor speaks view-space PIXELS (ARCore Coordinates2d.VIEW); our raycast(x,y) speaks dp,
    // so bridge px→dp here. The processor normalizes its bbox against viewWidth/Height.
    val density = resources.displayMetrics.density
    processor.process(
      frame, sceneView.width, sceneView.height, minConfidence,
      { px, py -> raycast(px / density, py / density) }
    ) { detections ->
      onDetections(mapOf("detections" to detections))
      detectionInFlight = false
    }
  }

  // MARK: - Per-frame projection (opt-in via emitProjections)
  // Projects each anchor's world position to screen dp so a 2D HUD can pin labels that
  // track in 3D. Throttled to ~30fps; skipped while not tracking or with <2 anchors.
  private fun emitProjectionsIfNeeded(frame: Frame) {
    if (!emitProjections || anchorsById.size < 2) return
    if (frame.camera.trackingState != TrackingState.TRACKING) return
    val now = frame.timestamp
    if (now - lastProjectionEmit < PROJECTION_THROTTLE_NS) return
    lastProjectionEmit = now

    val view = FloatArray(16).also { frame.camera.getViewMatrix(it, 0) }
    val proj = FloatArray(16).also { frame.camera.getProjectionMatrix(it, 0, NEAR_M, FAR_M) }
    val density = resources.displayMetrics.density
    // anchorsById is a LinkedHashMap → placement order preserved (matches iOS anchorOrder).
    val points = anchorsById.map { (id, anchor) ->
      val pose = anchor.pose
      project(id, pose.tx(), pose.ty(), pose.tz(), view, proj, density)
    }
    onProjection(mapOf("points" to points))
  }

  // clip = projection · view · worldPoint (column-major), then NDC → px (with the y-flip:
  // NDC is y-up, screen is y-down) → dp. inFront = clip.w > 0 (point ahead of the camera).
  private fun project(
    id: String, x: Float, y: Float, z: Float,
    view: FloatArray, proj: FloatArray, density: Float,
  ): Map<String, Any?> {
    val eye = mul(view, x, y, z, 1f)
    val clip = mul(proj, eye[0], eye[1], eye[2], eye[3])
    val w = clip[3]
    if (abs(w) < 1e-6f) return mapOf("id" to id, "x" to 0.0, "y" to 0.0, "inFront" to false)
    val ndcX = clip[0] / w
    val ndcY = clip[1] / w
    val px = (ndcX * 0.5f + 0.5f) * sceneView.width
    val py = (1f - (ndcY * 0.5f + 0.5f)) * sceneView.height
    return mapOf(
      "id" to id,
      "x" to (px / density).toDouble(),
      "y" to (py / density).toDouble(),
      "inFront" to (w > 0f),
    )
  }

  // Column-major 4x4 (FloatArray[16], m[col*4 + row]) times a vec4.
  private fun mul(m: FloatArray, x: Float, y: Float, z: Float, w: Float): FloatArray =
    floatArrayOf(
      m[0] * x + m[4] * y + m[8] * z + m[12] * w,
      m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w,
      m[3] * x + m[7] * y + m[11] * z + m[15] * w,
    )

  /// One-shot world→screen projection of a transform's translation. Returns null when
  /// there's no tracking frame. id is empty (no owning anchor for an ad-hoc point).
  fun worldToScreen(transform: List<Double>): Map<String, Any?>? {
    if (transform.size < 16) return null
    val frame = sceneView.frame ?: return null
    if (frame.camera.trackingState != TrackingState.TRACKING) return null
    val view = FloatArray(16).also { frame.camera.getViewMatrix(it, 0) }
    val proj = FloatArray(16).also { frame.camera.getProjectionMatrix(it, 0, NEAR_M, FAR_M) }
    return project(
      "", transform[12].toFloat(), transform[13].toFloat(), transform[14].toFloat(),
      view, proj, resources.displayMetrics.density,
    )
  }

  // MARK: - Geospatial extension (active only while trackingMode is "geo")

  // Per-frame: emit a throttled onGeoStateChange with the Earth state + camera geospatial pose.
  // No-op outside geo mode.
  private fun emitGeoIfNeeded(frame: Frame) {
    if (trackingMode != "geo") return
    val now = frame.timestamp
    if (now - lastGeoEmit < GEO_THROTTLE_NS) return
    lastGeoEmit = now
    val earth = sceneView.session?.earth
    val pose =
      if (earth != null &&
        earth.earthState == Earth.EarthState.ENABLED &&
        earth.trackingState == TrackingState.TRACKING
      ) {
        geoPoseMap(earth.cameraGeospatialPose)
      } else {
        null
      }
    onGeoStateChange(geoStateEventPayload(geoStateOf(earth), pose))
  }

  // EventDispatcher expects Map<String, Any>; nullable pose must be explicit null (iOS NSNull parity).
  @Suppress("UNCHECKED_CAST")
  private fun geoStateEventPayload(state: String, pose: Map<String, Any?>?): Map<String, Any> =
    hashMapOf<String, Any?>(
      "state" to state,
      "pose" to pose,
    ) as Map<String, Any>

  // Earth state → contract GeoTrackingState. No earth yet → still spinning up ("initializing").
  private fun geoStateOf(earth: Earth?): String {
    if (earth == null) return "initializing"
    return when (earth.earthState) {
      Earth.EarthState.ENABLED ->
        if (earth.trackingState == TrackingState.TRACKING) "localized" else "localizing"
      else -> "unavailable"
    }
  }

  /// VPS coverage check at a coordinate — resolve "available"|"unavailable"|"unknown".
  fun checkVpsAvailability(latitude: Double, longitude: Double, resolve: (String) -> Unit) {
    val session = sceneView.session
    if (session == null) {
      resolve("unknown")
      return
    }
    session.checkVpsAvailabilityAsync(latitude, longitude) { availability ->
      resolve(
        when (availability) {
          VpsAvailability.AVAILABLE -> "available"
          VpsAvailability.UNAVAILABLE -> "unavailable"
          else -> "unknown"
        }
      )
    }
  }

  /// Create a geo anchor at a real coordinate; emits onAnchorsChange (type "geo"). `altitude`
  /// null → the device's current altitude (synchronous; ARCore terrain resolution is async and
  /// not wired here). Requires the Earth to be TRACKING.
  fun addGeoAnchor(
    latitude: Double,
    longitude: Double,
    altitude: Double?,
    heading: Double,
  ): Map<String, Any?>? {
    if (trackingMode != "geo") return err("not_geo")
    val earth = sceneView.session?.earth ?: return err("no_earth")
    if (earth.earthState != Earth.EarthState.ENABLED ||
      earth.trackingState != TrackingState.TRACKING
    ) {
      return err("not_localized")
    }
    val quaternion = headingToQuaternion(heading)
    val alt = altitude ?: earth.cameraGeospatialPose.altitude
    val anchor = earth.createAnchor(latitude, longitude, alt, quaternion)
    return mapOf("id" to registerAnchor(anchor, geo = true))
  }

  /// Current device geospatial pose, or null when not localized.
  fun getGeospatialPose(): Map<String, Any?>? {
    val earth = sceneView.session?.earth ?: return null
    if (earth.earthState != Earth.EarthState.ENABLED ||
      earth.trackingState != TrackingState.TRACKING
    ) {
      return null
    }
    return geoPoseMap(earth.cameraGeospatialPose)
  }

  private fun geoPoseMap(p: GeospatialPose): Map<String, Any?> =
    mapOf(
      "latitude" to p.latitude,
      "longitude" to p.longitude,
      "altitude" to p.altitude,
      "horizontalAccuracy" to p.horizontalAccuracy,
      "verticalAccuracy" to p.verticalAccuracy,
      "headingAccuracy" to p.orientationYawAccuracy,
    )

  // Heading (degrees) → East-Up-South quaternion: a yaw rotation about the Up (+Y) axis.
  private fun headingToQuaternion(headingDegrees: Double): FloatArray {
    val half = Math.toRadians(headingDegrees) / 2.0
    return floatArrayOf(0f, Math.sin(half).toFloat(), 0f, Math.cos(half).toFloat())
  }

  // Matches the Swift mapping so onTrackingStateChange payloads are identical.
  private fun TrackingState.toContract() = when (this) {
    TrackingState.TRACKING -> "normal"
    TrackingState.PAUSED -> "limited"
    TrackingState.STOPPED -> "unavailable"
  }

  // MARK: - Generic primitives
  /// Screen point → world transform. With depth enabled/supported, hitTest returns
  /// DepthPoint results on arbitrary surfaces; otherwise it leans on planes/points.
  fun raycast(x: Float, y: Float): Map<String, Any?> {
    val frame = sceneView.frame ?: return nullHit()
    if (frame.camera.trackingState != TrackingState.TRACKING) return nullHit()
    // x/y arrive in RN dp (see onSingleTapConfirmed); hitTest wants physical pixels.
    val density = resources.displayMetrics.density
    val hit = frame.hitTest(x * density, y * density).firstOrNull {
      val t = it.trackable
      t is Plane || t is Point || t is DepthPoint
    } ?: return nullHit()
    return mapOf(
      "worldTransform" to flatten(hit.hitPose),
      "target" to targetString(hit.trackable),
    )
  }

  fun addAnchor(x: Float, y: Float): Map<String, Any?>? {
    val frame = sceneView.frame ?: return err("no_frame")
    if (frame.camera.trackingState != TrackingState.TRACKING) return err("no_frame")
    // x/y arrive in RN dp (see onSingleTapConfirmed); hitTest wants physical pixels.
    val density = resources.displayMetrics.density
    val hit = frame.hitTest(x * density, y * density).firstOrNull {
      val t = it.trackable
      t is Plane || t is Point || t is DepthPoint
    } ?: return err("no_hit")
    return mapOf("id" to registerAnchor(hit.createAnchor()))
  }

  /// CV-fusion extension: anchor directly at a world transform the detector already computed — a
  /// sibling of addAnchor(x,y) that skips the hit-test. `transform` is the 16-float column-major
  /// matrix; translation comes from the last column, rotation from the upper-left 3x3.
  fun addAnchorAtWorld(transform: List<Double>): Map<String, Any?>? {
    if (transform.size < 16) {
      onError(
        mapOf("code" to "bad_transform", "message" to "Expected a 16-element column-major transform.")
      )
      return null
    }
    val session = sceneView.session ?: return err("no_session")
    val m = FloatArray(16) { transform[it].toFloat() }
    val pose = Pose(floatArrayOf(m[12], m[13], m[14]), rotationQuaternion(m))
    return mapOf("id" to registerAnchor(session.createAnchor(pose)))
  }

  // Shared anchor-registration tail (id + bookkeeping + emit) used by addAnchor, addAnchorAtWorld,
  // and addGeoAnchor so all three stay in sync. `geo` tags the anchor type "geo" in serialize().
  private fun registerAnchor(anchor: Anchor, geo: Boolean = false): String {
    val id = (++anchorCounter).toString()
    anchorsById[id] = anchor
    if (geo) geoAnchorIds.add(id)
    emitAnchors()
    return id
  }

  // Rotation matrix (upper-left 3x3 of a column-major 4x4, m[col*4+row]) → quaternion [x,y,z,w],
  // the layout ARCore's Pose expects. Standard trace-based extraction; assumes a rigid (no-scale)
  // transform, which anchor poses are.
  private fun rotationQuaternion(m: FloatArray): FloatArray {
    val r00 = m[0]; val r10 = m[1]; val r20 = m[2]
    val r01 = m[4]; val r11 = m[5]; val r21 = m[6]
    val r02 = m[8]; val r12 = m[9]; val r22 = m[10]
    val trace = r00 + r11 + r22
    return when {
      trace > 0f -> {
        val s = sqrt(trace + 1f) * 2f // s = 4*qw
        floatArrayOf((r21 - r12) / s, (r02 - r20) / s, (r10 - r01) / s, 0.25f * s)
      }
      r00 > r11 && r00 > r22 -> {
        val s = sqrt(1f + r00 - r11 - r22) * 2f // s = 4*qx
        floatArrayOf(0.25f * s, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s)
      }
      r11 > r22 -> {
        val s = sqrt(1f + r11 - r00 - r22) * 2f // s = 4*qy
        floatArrayOf((r01 + r10) / s, 0.25f * s, (r12 + r21) / s, (r02 - r20) / s)
      }
      else -> {
        val s = sqrt(1f + r22 - r00 - r11) * 2f // s = 4*qz
        floatArrayOf((r02 + r20) / s, (r12 + r21) / s, 0.25f * s, (r10 - r01) / s)
      }
    }
  }

  fun removeAnchor(id: String) {
    anchorsById.remove(id)?.let {
      geoAnchorIds.remove(id)
      it.detach()
      emitAnchors()
    }
  }

  fun listAnchors(): List<Map<String, Any?>> = anchorsById.map { serialize(it.key, it.value) }

  // 2.3.0 has no built-in capture; PixelCopy on the underlying SurfaceView grabs the
  // GL/camera content (View.draw would yield a black frame).
  fun snapshotBase64(): String {
    val width = sceneView.width
    val height = sceneView.height
    if (width <= 0 || height <= 0) return ""
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val latch = CountDownLatch(1)
    var success = false
    val thread = HandlerThread("expo-ar-snapshot").apply { start() }
    try {
      PixelCopy.request(
        sceneView, bitmap,
        { result ->
          success = result == PixelCopy.SUCCESS
          latch.countDown()
        },
        Handler(thread.looper)
      )
      latch.await(2, TimeUnit.SECONDS)
    } catch (_: Exception) {
      return ""
    } finally {
      thread.quitSafely()
    }
    if (!success) return ""
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }

  // MARK: - Additive rendering primitives (placement feature)
  // attachModel/detachModel are NEW methods — they don't alter the session/anchor core.
  // The placement hook calls attachModel after addAnchor, and detachModel BEFORE
  // removeAnchor/reset. Scene-graph mutations are posted to the UI thread (Filament/
  // SceneView node ops must not run on the AsyncFunction worker thread).

  /// Attach a renderable under an AnchorNode so it tracks the anchor automatically. Loads
  /// a real glTF/GLB when `uri` resolves; otherwise renders a built-in cube (asset-free demo).
  fun attachModel(id: String, uri: String) {
    val anchor = anchorsById[id] ?: return
    post {
      detachModelInternal(id) // idempotent — replace any existing node for this anchor
      val anchorNode = AnchorNode(sceneView.engine, anchor)
      anchorNode.addChildNode(loadModelNode(uri))
      sceneView.addChildNode(anchorNode)
      modelNodesById[id] = anchorNode
    }
  }

  /// Remove a placed node. JS calls this alongside the core's removeAnchor.
  fun detachModel(id: String) {
    post { detachModelInternal(id) }
  }

  private fun detachModelInternal(id: String) {
    modelNodesById.remove(id)?.let { sceneView.removeChildNode(it) }
  }

  private fun loadModelNode(uri: String): Node {
    // Real model load: createModelInstance reads a glTF/GLB from an asset path or file
    // synchronously. Skip the "builtin:" sentinel and fall back to a primitive on failure.
    if (!uri.startsWith("builtin:")) {
      try {
        val instance = sceneView.modelLoader.createModelInstance(uri)
        return ModelNode(instance, true, 0.3f, null)
      } catch (_: Exception) {
        // fall through to the built-in primitive
      }
    }
    val material = sceneView.materialLoader.createColorInstance(Color.parseColor("#5EEAD4"))
    return CubeNode(sceneView.engine, Float3(0.1f, 0.1f, 0.1f), Float3(0f, 0.05f, 0f), material)
  }

  // MARK: - Anchor serialization — column-major 16-float transform matching the contract.
  private fun emitAnchors() =
    onAnchorsChange(mapOf("anchors" to anchorsById.map { serialize(it.key, it.value) }))

  private fun serialize(id: String, anchor: Anchor) =
    mapOf(
      "id" to id,
      "transform" to flatten(anchor.pose),
      "type" to if (geoAnchorIds.contains(id)) "geo" else "point",
    )

  // Pose.toMatrix is column-major — same layout as the iOS simd_float4x4 flatten, so a
  // JS transform array means the same thing on both platforms.
  private fun flatten(pose: Pose): FloatArray = FloatArray(16).also { pose.toMatrix(it, 0) }

  private fun targetString(t: Trackable) = when (t) {
    is Plane -> "plane"
    is DepthPoint -> "depth"
    is Point -> "feature"
    else -> "feature"
  }

  private fun nullHit() = mapOf("worldTransform" to null, "target" to null)

  private fun err(code: String): Map<String, Any?>? {
    onError(mapOf("code" to code, "message" to "No surface found."))
    return null
  }

  private companion object {
    const val PROJECTION_THROTTLE_NS = 33_000_000L // ~30fps
    const val GEO_THROTTLE_NS = 400_000_000L // ~2.5fps — geo pose/accuracy stream
    const val NEAR_M = 0.01f
    const val FAR_M = 100f
  }
}
