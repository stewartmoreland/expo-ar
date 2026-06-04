package expo.modules.ardetectors

import expo.modules.ar.ExpoArDetectorRegistry
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Registers the example ML Kit processor into expo-ar's registry at app startup. The registry name
// ("objects") must match the <ExpoArView detectionModel="objects" /> prop in App.tsx. No JS API.
class ArDetectorsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArDetectors")

    OnCreate {
      ExpoArDetectorRegistry.register("objects", MlKitObjectProcessor())
    }
  }
}
