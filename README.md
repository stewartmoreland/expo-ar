# expo-ar

> An open-source Expo native module that bridges **Apple ARKit** (iOS) and **Google ARCore** (Android) into a single React Native augmented-reality view.

[![CI](https://github.com/stewartmoreland/expo-ar/actions/workflows/ci.yml/badge.svg)](https://github.com/stewartmoreland/expo-ar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> **Status: early-stage / foundation.** The module scaffold is in place; the native ARKit and ARCore implementations are still being built. The API described under [Planned API](#planned-api) is the **target contract** — treat anything below as in progress until it lands.

## Why this exists

Building AR in a React Native app usually means writing two separate native integrations — ARKit in Swift, ARCore in Kotlin — and inventing your own bridge for each. `expo-ar` is **one custom Expo view** backed by ARKit on iOS and ARCore on Android, exposing the **same shared TypeScript contract** on both platforms.

It is intentionally **use-case agnostic**. The module exposes the generic AR primitives — session lifecycle, tracking, raycasting, anchors, plane detection, and depth/LiDAR — and leaves specific features (measurement, tap-to-place objects, room scanning, CV fusion) to be composed on top.

## Requirements

- **Expo SDK 50+** with the Expo Modules API.
- A **development build** — AR requires native code, so **Expo Go cannot run this**. Use EAS Build or a local dev build.
- **Physical devices.** Neither ARKit nor ARCore runs in the iOS Simulator or Android emulator; you need real hardware with motion sensors.

## Installation

```sh
npx expo install expo-ar
```

Then add the **config plugin** to your `app.json` (or `app.config.js`) and run a
prebuild. The plugin sets the iOS camera-usage description, the Android camera
permission, and the ARKit/ARCore manifest entries.

```json
{
  "expo": {
    "plugins": [
      [
        "expo-ar",
        {
          "cameraPermission": "Allow $(PRODUCT_NAME) to use the camera for AR.",
          "arRequired": false
        }
      ]
    ]
  }
}
```

| Option             | Type      | Default                                              | Effect |
| ------------------ | --------- | ---------------------------------------------------- | ------ |
| `cameraPermission` | `string`  | `"This app uses the camera for augmented reality."`  | iOS `NSCameraUsageDescription` prompt text. |
| `arRequired`       | `boolean` | `false`                                              | When `true`, the app installs **only on AR-capable devices**: iOS adds `arkit` to `UIRequiredDeviceCapabilities`; Android marks ARCore `required`. Leave `false` to keep the non-AR (`expo-camera`) fallback reachable on devices without AR. |

Because AR requires native code, you must use a **development build** — `expo prebuild` followed by EAS Build or a local build. **Expo Go cannot run this.**

```sh
npx expo prebuild
```

## Capability tiers

Detect support at runtime and branch; never assume LiDAR/Depth is present.

| Tier     | iOS                                  | Android                          | What works |
| -------- | ------------------------------------ | -------------------------------- | ---------- |
| **Best** | LiDAR (`supportsSceneReconstruction`)| Depth API (`AUTOMATIC`)          | Accurate depth on arbitrary surfaces, low light, untextured walls; mesh occlusion |
| **Good** | ARKit world tracking, no LiDAR       | ARCore, no depth                 | Tracking + planes; accurate on well-lit, textured surfaces and detected planes |
| **None** | No ARKit                             | Not an ARCore-supported device   | No AR — fall back to `expo-camera` |

## Planned API

> **Target API — in progress.** Names and shapes are the contract being built toward; both Swift and Kotlin emit byte-for-byte identical event names and payload keys.

**Module function (no view):**

| Function            | Returns                                          |
| ------------------- | ------------------------------------------------ |
| `getCapabilities()` | `{ arSupported, depthOrLidarAvailable }`         |

**`<ExpoArView />` props (JS → native):**

| Prop             | Type                                            | Notes |
| ---------------- | ----------------------------------------------- | ----- |
| `planeDetection` | `"none" \| "horizontal" \| "vertical" \| "both"`| Plane detection mode |
| `depthEnabled`   | `boolean`                                       | Enable LiDAR/Depth (off by default) |
| `debug`          | `boolean`                                       | Draw detected planes / feature points |
| `emitProjections`| `boolean`                                       | Opt-in: stream anchor → screen positions each frame via `onProjection` (drives object-pinned 2D labels) |

**Ref functions (JS → native, via view ref):**

| Function            | Returns / effect |
| ------------------- | ---------------- |
| `raycast(x, y)`     | `{ worldTransform, target }` — the universal "screen point → 3D" primitive |
| `addAnchor(x, y)`   | `{ id } \| null` — raycast + create a persistent anchor |
| `removeAnchor(id)`  | Remove an anchor |
| `listAnchors()`     | Current anchors |
| `pause()` / `resume()` / `reset()` | Session lifecycle control (`reset` clears anchors and restarts tracking) |
| `snapshot()`        | `base64` image |
| `worldToScreen(transform)` | `{ id, x, y, inFront } \| null` — project a 3D point to screen coordinates (the inverse of `raycast`) |

**Events (native → JS):**

| Event                   | Payload |
| ----------------------- | ------- |
| `onReady`               | `{ capabilities }` |
| `onTrackingStateChange` | `{ state }` |
| `onTap`                 | `{ x, y }` |
| `onAnchorsChange`       | `{ anchors: [{ id, transform, type }] }` |
| `onProjection`          | `{ points: [{ id, x, y, inFront }] }` — per-frame, only while `emitProjections` is set |
| `onError`               | `{ code, message }` |

Everything a feature needs is composed from these: measurement = raycast on tap → store world points → compute geometry; object placement = `addAnchor` → attach a model to the anchor. Poses are 4×4 transforms serialized as a 16-number, column-major array; all math is in **meters**.

## Development

```sh
git clone https://github.com/stewartmoreland/expo-ar.git
cd expo-ar
npm install
npm run build      # compile TypeScript
npm run lint       # eslint
npm test           # jest
```

The [`example/`](./example) app is the development harness — two worked features (measurement with object-pinned tape labels, and tap-to-place) composed on the same core. See [`example/README.md`](./example/README.md) for how to build and run the demo. Run it as a development build on a **physical device** — AR does not work in a simulator/emulator.

## Contributing

Contributions are welcome. The repo's [`AGENTS.md`](./AGENTS.md) documents the architecture, the cross-platform contract discipline, and the build/test workflow — start there before changing native code.

## License

[MIT](./LICENSE) © Stewart Moreland
