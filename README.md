# @stewmore/expo-ar

> An open-source Expo native module that bridges **Apple ARKit** (iOS) and **Google ARCore** (Android) into a single React Native augmented-reality view.

[![CI](https://github.com/stewartmoreland/expo-ar/actions/workflows/ci.yml/badge.svg)](https://github.com/stewartmoreland/expo-ar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## Why this exists

Building AR in a React Native app usually means writing two separate native integrations — ARKit in Swift, ARCore in Kotlin — and inventing your own bridge for each. `expo-ar` is **one custom Expo view** backed by ARKit on iOS and ARCore on Android, exposing the **same shared TypeScript contract** on both platforms.

It is intentionally **use-case agnostic**. The module exposes the generic AR primitives — session lifecycle, tracking, raycasting, anchors, plane detection, and depth/LiDAR — and leaves specific features (measurement, tap-to-place objects, room scanning, CV fusion) to be composed on top.

## Requirements

- **Expo SDK 56** with the Expo Modules API.
- A **development build** — AR requires native code, so **Expo Go cannot run this**. Use EAS Build or a local dev build.
- **Physical devices.** Neither ARKit nor ARCore runs in the iOS Simulator or Android emulator; you need real hardware with motion sensors.

## Installation

```sh
npx expo install @stewmore/expo-ar
```

Then add the **config plugin** to your `app.json` (or `app.config.js`) and run a
prebuild. The plugin sets the iOS camera-usage description, the Android camera
permission, and the ARKit/ARCore manifest entries.

```json
{
  "expo": {
    "plugins": [
      [
        "@stewmore/expo-ar",
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

## Quick start

Probe support **before** mounting the view, then render `<ExpoArView />` and drive it
through its ref. Don't act on raycasts until tracking reaches `normal` —
raycasts during `initializing`/`limited` return garbage.

```tsx
import { useRef, useState } from 'react';
import { View } from 'react-native';
import {
  ExpoArView,
  getCapabilities,
  type ArViewHandle,
  type Capabilities,
  type TapEvent,
} from '@stewmore/expo-ar';

export function ArScreen() {
  const ref = useRef<ArViewHandle>(null);
  const [caps] = useState<Capabilities>(() => getCapabilities());

  // No ARKit/ARCore here (and always on web) — render your non-AR fallback instead.
  if (!caps.arSupported) {
    return <View /* expo-camera fallback */ />;
  }

  return (
    <ExpoArView
      ref={ref}
      style={{ flex: 1 }}
      planeDetection="both"
      depthEnabled
      onReady={(e) => console.log('AR ready', e.nativeEvent.capabilities)}
      onTrackingStateChange={(e) => console.log('tracking', e.nativeEvent.state)}
      // A tap raycasts and drops a persistent anchor at the hit point.
      onTap={async (e: TapEvent) => {
        const anchor = await ref.current?.addAnchor(e.nativeEvent.x, e.nativeEvent.y);
        if (anchor) console.log('placed', anchor.id);
      }}
      onError={(e) => console.warn(e.nativeEvent.code, e.nativeEvent.message)}
    />
  );
}
```

> **The AR view owns the camera.** An ARKit/ARCore session takes **exclusive** control of
> the camera — never stack the AR view over `expo-camera`, or you get a black frame. Only
> one AR session runs app-wide; pause it on blur and resume on focus.

The barrel also re-exports a few conveniences built on the same contract: the
`useArSession` reducer/hook (`useArSession`, `arSessionReducer`, `initialArSessionState`)
for managing tracking/anchor state, and matrix helpers from `./transform` for working with
the 16-number column-major poses.

## Capability tiers

Detect support at runtime and branch; never assume LiDAR/Depth is present.

| Tier     | iOS                                  | Android                          | What works |
| -------- | ------------------------------------ | -------------------------------- | ---------- |
| **Best** | LiDAR (`supportsSceneReconstruction`)| Depth API (`AUTOMATIC`)          | Accurate depth on arbitrary surfaces, low light, untextured walls; mesh occlusion |
| **Good** | ARKit world tracking, no LiDAR       | ARCore, no depth                 | Tracking + planes; accurate on well-lit, textured surfaces and detected planes |
| **None** | No ARKit                             | Not an ARCore-supported device   | No AR — fall back to `expo-camera` |

## API

Both Swift and Kotlin emit byte-for-byte identical event names and payload keys, and accept identical prop/function signatures. The canonical contract lives in [`src/ExpoAr.types.ts`](./src/ExpoAr.types.ts).

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
| `snapshot()`        | `base64` JPEG of the rendered scene |
| `worldToScreen(transform)` | `{ id, x, y, inFront } \| null` — project a 3D point to screen coordinates (the inverse of `raycast`) |
| `attachModel(anchorId, modelUri)` | Render a model at an anchor — a USDZ/SCN (iOS) or glTF/GLB (Android) URL, or the built-in `"builtin:cube"`. Additive rendering primitive used by tap-to-place |
| `detachModel(anchorId)` | Remove the model attached to an anchor (leaves the anchor) |

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

### Releasing

Releases are automated with [release-it](https://github.com/release-it/release-it). When a
PR is merged to `main`, the `release` job in [`ci.yml`](./.github/workflows/ci.yml) (after
the build/lint/test gate) runs `release-it --ci`, which:

- picks the next version from the merged [Conventional Commits](https://www.conventionalcommits.org/)
  (`fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE` → major) and updates
  `CHANGELOG.md`;
- syncs that version into the native specs (`ios/ExpoAr.podspec`, `android/build.gradle`,
  `plugin/src/index.ts`) via [`sync-version.js`](./internal/module_scripts/sync-version.js);
- commits + tags `vX.Y.Z`, creates the GitHub release, and publishes to npm.

Use Conventional Commit messages (or squash-merge PRs with a conventional title) so the bump
is correct. **Setup:** add an automation-scoped `NPM_TOKEN` as a repository secret; the
built-in `GITHUB_TOKEN` handles the tag, push, and GitHub release. To preview locally:
`npx release-it --ci --dry-run`.

## Contributing

Contributions are welcome. The repo's [`AGENTS.md`](./AGENTS.md) documents the architecture, the cross-platform contract discipline, and the build/test workflow — start there before changing native code.

## License

[MIT](./LICENSE) © Stewart Moreland
