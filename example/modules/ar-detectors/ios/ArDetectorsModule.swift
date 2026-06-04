import ExpoAr
import ExpoModulesCore

// Registers the example Vision processor into expo-ar's registry at app startup. The registry name
// ("objects") must match the <ExpoArView detectionModel="objects" /> prop in App.tsx. No JS API.
public class ArDetectorsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArDetectors")

    OnCreate {
      ExpoArDetectorRegistry.register(name: "objects", processor: VisionObjectProcessor())
    }
  }
}
