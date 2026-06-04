import ARKit
import ExpoModulesCore

// Geospatial extension: input for addGeoAnchor. altitude == nil → ground/terrain level.
// heading is part of the shared contract but unused on iOS (ARGeoAnchor has no heading).
struct GeoAnchorInput: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var altitude: Double?
  @Field var heading: Double = 0
}

public class ExpoArModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAr")

    // Sync probe — callable before any view mounts so JS can branch to the
    // expo-camera fallback before deciding to render <ExpoArView/>. Keys must
    // match the Capabilities contract in src/ExpoAr.types.ts.
    Function("getCapabilities") { () -> [String: Any] in
      [
        "arSupported": ARWorldTrackingConfiguration.isSupported,
        "depthOrLidarAvailable":
          ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh),
        // Geospatial extension: VPS/geo tracking capability (independent of coverage).
        "geoTrackingSupported": ARGeoTrackingConfiguration.isSupported,
      ]
    }

    View(ExpoArView.self) {
      // Event names are byte-for-byte identical to the Kotlin side — drift here
      // is the #1 "event never fires" bug.
      Events(
        "onReady", "onTrackingStateChange", "onTap", "onAnchorsChange", "onProjection",
        "onGeoStateChange", "onError")

      Prop("planeDetection") { (view: ExpoArView, mode: String) in
        view.setPlaneDetection(mode)
      }
      Prop("depthEnabled") { (view: ExpoArView, on: Bool) in
        view.setDepthEnabled(on)
      }
      Prop("debug") { (view: ExpoArView, on: Bool) in
        view.setDebug(on)
      }
      Prop("emitProjections") { (view: ExpoArView, on: Bool) in
        view.setEmitProjections(on)
      }
      // Geospatial extension: "world" | "geo" — switches the session configuration.
      Prop("trackingMode") { (view: ExpoArView, mode: String) in
        view.setTrackingMode(mode)
      }

      // Generic primitives — features compose these via the imperative ref.
      AsyncFunction("raycast") { (view: ExpoArView, x: Double, y: Double) -> [String: Any] in
        view.raycast(at: CGPoint(x: x, y: y))
      }
      AsyncFunction("addAnchor") { (view: ExpoArView, x: Double, y: Double) -> [String: Any]? in
        view.addAnchor(at: CGPoint(x: x, y: y))
      }
      AsyncFunction("removeAnchor") { (view: ExpoArView, id: String) in
        view.removeAnchor(id: id)
      }
      AsyncFunction("listAnchors") { (view: ExpoArView) -> [[String: Any]] in
        view.listAnchors()
      }
      AsyncFunction("pause") { (view: ExpoArView) in view.pauseSession() }
      AsyncFunction("resume") { (view: ExpoArView) in view.resumeSession() }
      AsyncFunction("reset") { (view: ExpoArView) in view.resetSession() }
      AsyncFunction("snapshot") { (view: ExpoArView) -> String in view.snapshotBase64() }
      AsyncFunction("worldToScreen") { (view: ExpoArView, transform: [Double]) -> [String: Any]? in
        view.worldToScreen(transform)
      }

      // Geospatial extension primitives — active only while trackingMode is "geo". The two
      // ARKit calls are async (completion handlers), so they resolve via a Promise.
      AsyncFunction("checkVpsAvailability") {
        (view: ExpoArView, latitude: Double, longitude: Double, promise: Promise) in
        view.checkVpsAvailability(latitude, longitude) { result in promise.resolve(result) }
      }
      AsyncFunction("addGeoAnchor") { (view: ExpoArView, input: GeoAnchorInput) -> [String: Any]? in
        view.addGeoAnchor(input.latitude, input.longitude, input.altitude)
      }
      AsyncFunction("getGeospatialPose") { (view: ExpoArView, promise: Promise) in
        view.getGeospatialPose { pose in promise.resolve(pose) }
      }

      // Additive rendering primitives — used by the placement feature. These attach/
      // detach a renderable on an existing anchor; they don't touch session/anchor core.
      AsyncFunction("attachModel") { (view: ExpoArView, id: String, uri: String) in
        view.attachModel(id, uri)
      }
      AsyncFunction("detachModel") { (view: ExpoArView, id: String) in
        view.detachModel(id)
      }
    }
  }
}
