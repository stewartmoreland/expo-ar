import ARKit
import ExpoModulesCore

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
      ]
    }

    View(ExpoArView.self) {
      // Event names are byte-for-byte identical to the Kotlin side — drift here
      // is the #1 "event never fires" bug.
      Events("onReady", "onTrackingStateChange", "onTap", "onAnchorsChange", "onError")

      Prop("planeDetection") { (view: ExpoArView, mode: String) in
        view.setPlaneDetection(mode)
      }
      Prop("depthEnabled") { (view: ExpoArView, on: Bool) in
        view.setDepthEnabled(on)
      }
      Prop("debug") { (view: ExpoArView, on: Bool) in
        view.setDebug(on)
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
