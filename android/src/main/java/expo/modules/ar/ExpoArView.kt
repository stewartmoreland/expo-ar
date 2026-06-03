package expo.modules.ar

import android.content.Context
import android.graphics.Bitmap
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
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.Pose
import com.google.ar.core.Trackable
import com.google.ar.core.TrackingState
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import io.github.sceneview.ar.ARSceneView
import io.github.sceneview.gesture.GestureDetector
import io.github.sceneview.node.Node
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

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
  private val onError by EventDispatcher()

  val sceneView = ARSceneView(context)
  protected val anchorsById = mutableMapOf<String, Anchor>()

  private var planeMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
  private var depthEnabled = true
  private var depthAvailable = false
  private var didReportReady = false
  private var lastState: TrackingState? = null
  private var anchorCounter = 0

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
        onTap(mapOf("x" to e.x, "y" to e.y))
      }
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
            )
          )
        )
      }
    }
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
    val hit = frame.hitTest(x, y).firstOrNull {
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
    val hit = frame.hitTest(x, y).firstOrNull {
      val t = it.trackable
      t is Plane || t is Point || t is DepthPoint
    } ?: return err("no_hit")
    val anchor = hit.createAnchor()
    val id = (++anchorCounter).toString()
    anchorsById[id] = anchor
    emitAnchors()
    return mapOf("id" to id)
  }

  fun removeAnchor(id: String) {
    anchorsById.remove(id)?.let {
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

  // MARK: - Anchor serialization — column-major 16-float transform matching the contract.
  private fun emitAnchors() =
    onAnchorsChange(mapOf("anchors" to anchorsById.map { serialize(it.key, it.value) }))

  private fun serialize(id: String, anchor: Anchor) =
    mapOf("id" to id, "transform" to flatten(anchor.pose), "type" to "point")

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
}
