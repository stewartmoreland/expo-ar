# Android — generic ARCore core

The use-case-agnostic ARCore side of `expo-ar`: session + install flow, config, tracking, the hit-test/raycast primitive, anchors, plane detection, Depth API, frame-image access, snapshot. Features extend this view. Files under `modules/expo-ar/android/src/main/java/expo/modules/ar/`.

ARCore's APIs (`Session`, `Frame.hitTest`, `Anchor`, `Pose`, `Config`) are stable Google APIs and are shown precisely. Rendering uses **SceneView** (`io.github.sceneview:arsceneview`, Filament-backed) to avoid hundreds of lines of raw OpenGL; its *view-level* API shifts between major versions, so verify method names against the version you install and adapt. The ARCore logic below is what carries every feature.

## "LiDAR" on Android = the Depth API

Few Android phones have ToF/LiDAR hardware, but ARCore's Depth API derives depth from motion + ML on a wide device range. Treat "Depth supported" (not "has ToF") as the accuracy switch; it's **off by default** and must be enabled. With it on, `Frame.hitTest` returns `DepthPoint` results, so raycasts land on arbitrary surfaces, not just detected planes.

## Gradle — `android/build.gradle`

```gradle
dependencies {
  implementation "com.google.ar:core:1.45.0"             // ARCore SDK (use latest)
  implementation "io.github.sceneview:arsceneview:2.2.1" // Filament-backed AR view (verify version)
}
```
`minSdkVersion` ≥ 24. Manifest entries are added by the config plugin (`config-plugin.md`).

## Module — `ExpoArModule.kt`

```kotlin
package expo.modules.ar

import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoArModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAr")

    Function("getCapabilities") {
      val ctx = appContext.reactContext!!
      val avail = ArCoreApk.getInstance().checkAvailability(ctx)
      var depth = false
      if (avail == ArCoreApk.Availability.SUPPORTED_INSTALLED) {
        try { Session(ctx).use { depth = it.isDepthModeSupported(Config.DepthMode.AUTOMATIC) } }
        catch (_: Exception) {}
      }
      mapOf("arSupported" to avail.isSupported, "depthOrLidarAvailable" to depth)
    }

    View(ExpoArView::class) {
      Events("onReady", "onTrackingStateChange", "onTap", "onAnchorsChange", "onError")

      Prop("planeDetection") { v: ExpoArView, mode: String -> v.setPlaneDetection(mode) }
      Prop("depthEnabled")   { v: ExpoArView, on: Boolean   -> v.setDepthEnabled(on) }
      Prop("debug")          { v: ExpoArView, on: Boolean   -> v.setDebug(on) }

      AsyncFunction("raycast")      { v: ExpoArView, x: Double, y: Double -> v.raycast(x.toFloat(), y.toFloat()) }
      AsyncFunction("addAnchor")    { v: ExpoArView, x: Double, y: Double -> v.addAnchor(x.toFloat(), y.toFloat()) }
      AsyncFunction("removeAnchor") { v: ExpoArView, id: String -> v.removeAnchor(id) }
      AsyncFunction("listAnchors")  { v: ExpoArView -> v.listAnchors() }
      AsyncFunction("pause")    { v: ExpoArView -> v.pauseSession() }
      AsyncFunction("resume")   { v: ExpoArView -> v.resumeSession() }
      AsyncFunction("reset")    { v: ExpoArView -> v.resetSession() }
      AsyncFunction("snapshot") { v: ExpoArView -> v.snapshotBase64() }
    }
  }
}
```

## View — `ExpoArView.kt`

```kotlin
package expo.modules.ar

import android.content.Context
import com.google.ar.core.*
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.sceneview.ar.ARSceneView

open class ExpoArView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onReady by EventDispatcher()
  private val onTrackingStateChange by EventDispatcher()
  private val onTap by EventDispatcher()
  private val onAnchorsChange by EventDispatcher()
  private val onError by EventDispatcher()

  val sceneView = ARSceneView(context)                       // exposed to feature code
  protected val anchorsById = mutableMapOf<String, Anchor>()

  private var planeMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
  private var depthEnabled = true
  private var depthAvailable = false
  private var didReportReady = false
  private var lastState: TrackingState? = null

  init {
    addView(sceneView)
    configure()
    sceneView.onSessionUpdated = { _, frame -> onFrame(frame) }
    sceneView.setOnGestureListener(onSingleTapConfirmed = { e, _ -> onTap(mapOf("x" to e.x, "y" to e.y)); true })
  }

  private fun configure() {
    sceneView.configureSession { session, config ->
      depthAvailable = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
      config.depthMode = if (depthEnabled && depthAvailable) Config.DepthMode.AUTOMATIC else Config.DepthMode.DISABLED
      config.planeFindingMode = planeMode
      config.lightEstimationMode = Config.LightEstimationMode.ENVIRONMENTAL_HDR
    }
  }

  // Props
  fun setPlaneDetection(mode: String) {
    planeMode = when (mode) {
      "none" -> Config.PlaneFindingMode.DISABLED
      "horizontal" -> Config.PlaneFindingMode.HORIZONTAL
      "vertical" -> Config.PlaneFindingMode.VERTICAL
      else -> Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
    }; configure()
  }
  fun setDepthEnabled(on: Boolean) { depthEnabled = on; configure() }
  fun setDebug(on: Boolean) { sceneView.planeRenderer.isEnabled = on }

  // Lifecycle — forward to SceneView (it manages the ARCore session + install flow).
  fun pauseSession()  { sceneView.onPause(findLifecycleOwner()) }
  fun resumeSession() { sceneView.onResume(findLifecycleOwner()) }
  fun resetSession() {
    anchorsById.values.forEach { it.detach() }; anchorsById.clear()
    emitAnchors(); configure()
  }

  private fun onFrame(frame: Frame) {
    val state = frame.camera.trackingState
    if (state != lastState) {
      lastState = state
      onTrackingStateChange(mapOf("state" to state.toContract()))
      if (!didReportReady && state == TrackingState.TRACKING) {
        didReportReady = true
        onReady(mapOf("capabilities" to mapOf(
          "arSupported" to true, "depthOrLidarAvailable" to depthAvailable)))
      }
    }
    // Fuse CV here: frame.acquireCameraImage() -> run a model -> raycast the result. Throttle & close the image.
  }

  private fun TrackingState.toContract() = when (this) {
    TrackingState.TRACKING -> "normal"; TrackingState.PAUSED -> "limited"; TrackingState.STOPPED -> "unavailable"
  }

  // Generic primitives
  fun raycast(x: Float, y: Float): Map<String, Any?> {
    val frame = sceneView.frame ?: return nullHit()
    if (frame.camera.trackingState != TrackingState.TRACKING) return nullHit()
    val hit = frame.hitTest(x, y).firstOrNull {
      val t = it.trackable; t is Plane || t is Point || t is DepthPoint
    } ?: return nullHit()
    return mapOf("worldTransform" to flatten(hit.hitPose), "target" to targetString(hit.trackable))
  }

  fun addAnchor(x: Float, y: Float): Map<String, Any?>? {
    val frame = sceneView.frame ?: return err("no_frame")
    val hit = frame.hitTest(x, y).firstOrNull {
      val t = it.trackable; t is Plane || t is Point || t is DepthPoint
    } ?: return err("no_hit")
    val anchor = hit.createAnchor()
    val id = anchor.hashCode().toString()
    anchorsById[id] = anchor
    emitAnchors()
    return mapOf("id" to id)
  }

  fun removeAnchor(id: String) { anchorsById.remove(id)?.let { it.detach(); emitAnchors() } }
  fun listAnchors(): List<Map<String, Any?>> = anchorsById.map { serialize(it.key, it.value) }
  fun snapshotBase64(): String = "" /* capture via PixelCopy on sceneView; return base64 */

  // Anchor serialization — column-major 16-float transform matching the contract.
  private fun emitAnchors() = onAnchorsChange(mapOf("anchors" to anchorsById.map { serialize(it.key, it.value) }))
  private fun serialize(id: String, a: Anchor) =
    mapOf("id" to id, "transform" to flatten(a.pose), "type" to "point")
  private fun flatten(pose: Pose): FloatArray = FloatArray(16).also { pose.toMatrix(it, 0) } // column-major
  private fun targetString(t: Trackable) = when (t) {
    is Plane -> "plane"; is DepthPoint -> "depth"; is Point -> "feature"; else -> "feature"
  }

  private fun nullHit() = mapOf("worldTransform" to null, "target" to null)
  private fun err(code: String): Map<String, Any?>? { onError(mapOf("code" to code, "message" to "No surface found.")); return null }
  private fun findLifecycleOwner(): androidx.lifecycle.LifecycleOwner =
    (context as? androidx.lifecycle.LifecycleOwner) ?: throw IllegalStateException("No LifecycleOwner")
}
```

## Notes & gotchas

- **`Pose.toMatrix` is column-major**, the same layout as the iOS `simd_float4x4` flatten — so a JS transform array means the same thing on both platforms. Keep it that way.
- **Depth is opt-in.** No `DepthMode.AUTOMATIC` → no `DepthPoint` hits → accuracy collapses on objects. The `configure()` path gates on `depthAvailable` so it degrades cleanly.
- **ARCore install flow.** Google Play Services for AR may need install/update at runtime via `ArCoreApk.requestInstall`. SceneView handles this through its lifecycle; a hand-rolled `Session` must call it before `new Session(...)`.
- **Lifecycle.** SceneView's session is tied to a `LifecycleOwner`; forward pause/resume from JS on screen blur/focus. Getting this wrong is the top Android AR crash.
- **`open class` + exposed `sceneView`/`anchorsById`** so a feature can subclass and attach nodes on `onAnchorsChange`.
- **Rendering is the version-sensitive layer.** Keep measurement/placement *math* in the ARCore pose code (stable); treat node creation as the part to adapt to your SceneView version, or swap in an existing renderer.
