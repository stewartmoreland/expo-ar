// Native-only local module: it registers example CV frame processors (Apple Vision on iOS, ML Kit on
// Android) into expo-ar's ExpoArDetectorRegistry at app startup, via each platform Module's OnCreate.
// There is NO JS API — nothing to import. <ExpoArView detectionModel="objects" /> selects the
// processor this module registers under the name "objects". See ./README.md for the prebuild + the
// one Android gradle line to verify.
export {};
