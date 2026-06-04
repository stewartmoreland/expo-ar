package expo.modules.ar

import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// Geospatial extension: input for addGeoAnchor. altitude == null → terrain/ground level.
class GeoAnchorInput : Record {
  @Field var latitude: Double = 0.0
  @Field var longitude: Double = 0.0
  @Field var altitude: Double? = null
  @Field var heading: Double = 0.0
}

class ExpoArModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAr")

    // Sync probe — callable before any view mounts so JS can branch to the
    // expo-camera fallback. Keys must match the Capabilities contract in
    // src/ExpoAr.types.ts and the iOS getCapabilities.
    Function("getCapabilities") {
      val ctx = appContext.reactContext!!
      val availability = ArCoreApk.getInstance().checkAvailability(ctx)
      var depth = false
      var geo = false
      if (availability == ArCoreApk.Availability.SUPPORTED_INSTALLED) {
        // A throwaway Session is the only way to probe depth/geospatial support; close it
        // immediately. Swallow failures (e.g. AR not installed yet).
        try {
          val session = Session(ctx)
          try {
            depth = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
            geo = session.isGeospatialModeSupported(Config.GeospatialMode.ENABLED)
          } finally {
            session.close()
          }
        } catch (_: Exception) {
        }
      }
      mapOf(
        "arSupported" to availability.isSupported,
        "depthOrLidarAvailable" to depth,
        // Geospatial extension: VPS/geo tracking capability (independent of coverage).
        "geoTrackingSupported" to geo,
      )
    }

    View(ExpoArView::class) {
      // Event names are byte-for-byte identical to the Swift side — drift here is
      // the #1 "event never fires" bug.
      Events(
        "onReady", "onTrackingStateChange", "onTap", "onAnchorsChange", "onProjection",
        "onGeoStateChange", "onError")

      Prop("planeDetection") { view: ExpoArView, mode: String -> view.setPlaneDetection(mode) }
      Prop("depthEnabled") { view: ExpoArView, on: Boolean -> view.setDepthEnabled(on) }
      Prop("debug") { view: ExpoArView, on: Boolean -> view.setDebug(on) }
      Prop("emitProjections") { view: ExpoArView, on: Boolean -> view.setEmitProjections(on) }
      // Geospatial extension: "world" | "geo" — switches the session configuration.
      Prop("trackingMode") { view: ExpoArView, mode: String -> view.setTrackingMode(mode) }

      AsyncFunction("raycast") { view: ExpoArView, x: Double, y: Double ->
        view.raycast(x.toFloat(), y.toFloat())
      }
      AsyncFunction("addAnchor") { view: ExpoArView, x: Double, y: Double ->
        view.addAnchor(x.toFloat(), y.toFloat())
      }
      AsyncFunction("removeAnchor") { view: ExpoArView, id: String -> view.removeAnchor(id) }
      AsyncFunction("listAnchors") { view: ExpoArView -> view.listAnchors() }
      AsyncFunction("pause") { view: ExpoArView -> view.pauseSession() }
      AsyncFunction("resume") { view: ExpoArView -> view.resumeSession() }
      AsyncFunction("reset") { view: ExpoArView -> view.resetSession() }
      AsyncFunction("snapshot") { view: ExpoArView -> view.snapshotBase64() }
      AsyncFunction("worldToScreen") { view: ExpoArView, transform: List<Double> ->
        view.worldToScreen(transform)
      }

      // Geospatial extension primitives — active only while trackingMode is "geo".
      // checkVpsAvailability is async (callback) so it resolves via a Promise.
      AsyncFunction("checkVpsAvailability") {
        view: ExpoArView, latitude: Double, longitude: Double, promise: Promise ->
        view.checkVpsAvailability(latitude, longitude) { result -> promise.resolve(result) }
      }
      AsyncFunction("addGeoAnchor") { view: ExpoArView, input: GeoAnchorInput ->
        view.addGeoAnchor(input.latitude, input.longitude, input.altitude, input.heading)
      }
      AsyncFunction("getGeospatialPose") { view: ExpoArView -> view.getGeospatialPose() }

      // Additive rendering primitives — used by the placement feature. These attach/
      // detach a renderable on an existing anchor; they don't touch session/anchor core.
      AsyncFunction("attachModel") { view: ExpoArView, id: String, uri: String ->
        view.attachModel(id, uri)
      }
      AsyncFunction("detachModel") { view: ExpoArView, id: String -> view.detachModel(id) }
    }
  }
}
