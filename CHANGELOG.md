# Changelog

## [0.2.1](https://github.com/stewartmoreland/expo-ar/compare/v0.2.0...v0.2.1) (2026-06-11)

### Bug Fixes

* update ARCore dependency and improve geo state handling ([dbb68b9](https://github.com/stewartmoreland/expo-ar/commit/dbb68b909770935429c694d6b8de8e11b756dd73))

## 0.2.0 (2026-06-04)

### Features

* add CV-fusion object detection (native frame processors + detection HUD) ([ef2d6ae](https://github.com/stewartmoreland/expo-ar/commit/ef2d6ae1a747c79696b5be09b607c4cb0c6cf9ae))
* add geospatial/VPS anchoring (ARGeoTracking + ARCore Geospatial) ([056bff5](https://github.com/stewartmoreland/expo-ar/commit/056bff5cffc01ec6cfde7d6e264d2f2cc816630b))
* enhance AR documentation and add CV fusion example ([ebaa666](https://github.com/stewartmoreland/expo-ar/commit/ebaa6667103c92efe23d273569cb7528e5d049a9))

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-03

Initial release — the module foundation and a working example harness.

### Added

- Shared TypeScript AR contract (`src/ExpoAr.types.ts`): session lifecycle,
  tracking, raycast, anchors, plane detection, and depth/LiDAR primitives, with
  byte-for-byte identical event names and payload keys across platforms.
- iOS ARKit core (`ios/ExpoArModule.swift`, `ios/ExpoArView.swift`) and Android
  ARCore core (`android/src/main/java/expo/modules/ar/*`).
- Config plugin (`plugin/`, `app.plugin.js`) handling the camera permission and
  ARKit/ARCore manifest entries, with `cameraPermission` and `arRequired` options.
- `example/` development harness with two worked features — object-pinned
  measurement and tap-to-place — composed on the same generic core.
- CI/CD: GitHub Actions verification gate (build, lint, test) on pull requests
  and `main`, and an EAS Workflow that builds installable iOS/Android dev-client
  artifacts for the example app.
- Packaging: explicit `files` allowlist so the published package ships only the
  compiled module, config plugin, and native sources.

[Unreleased]: https://github.com/stewartmoreland/expo-ar/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stewartmoreland/expo-ar/releases/tag/v0.1.0
