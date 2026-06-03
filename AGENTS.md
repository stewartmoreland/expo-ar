# AGENTS.md — working in the `expo-ar` repo

## Read the versioned Expo docs first

Expo and the Expo Modules API change across SDK versions. This repo is on **Expo SDK 56** (see `package.json`). **Before writing any native or module code, read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/** — do not rely on memorized APIs.

## What this project is

`expo-ar` is an **open-source Expo native module** that bridges **Apple ARKit** (iOS, Swift) and **Google ARCore** (Android, Kotlin) into a single React Native AR view, behind one shared TypeScript contract. It is a **standalone, publishable module** (its own `package.json`, podspec, Gradle, and `example/` app) — not a local module under a host app.

The core is **use-case agnostic**: it exposes generic AR primitives (session lifecycle, tracking, raycast, anchors, planes, depth/LiDAR). Specific features (measurement, tap-to-place, room scanning) are composed on top, not baked in.

## Repo layout

| Path | What it is |
| ---- | ---------- |
| `src/index.ts` | Public barrel — re-exports the native module + types |
| `src/ExpoAr.types.ts` | Shared TypeScript contract (props, events, function signatures, payload shapes) |
| `src/ExpoArModule.ts` / `src/ExpoArModule.web.ts` | Native module binding (web is the no-AR stub) |
| `ios/ExpoArModule.swift` | iOS module — ARKit implementation |
| `ios/ExpoAr.podspec` | iOS pod spec |
| `android/src/main/java/expo/modules/ar/ExpoArModule.kt` | Android module — ARCore implementation |
| `android/src/main/AndroidManifest.xml` | Android manifest |
| `expo-module.config.json` | Autolinking config |
| `example/` | Development harness app |
| `internal/module_scripts/` | Build / clean / test tooling |

**Module naming in `expo-module.config.json`:** iOS uses the bare class name `ExpoArModule`; Android uses the fully-qualified name `expo.modules.ar.ExpoArModule`. The native `Name("ExpoAr")` is what JS calls `requireNativeModule("ExpoAr")` against — keep these consistent.

## The cardinal AR rule: the AR view owns the camera

An ARKit `ARSession` / ARCore `Session` takes **exclusive** control of the camera. **Never stack ARKit/ARCore content over `expo-camera`** — it silently yields a black frame. The `expo-ar` view renders the camera feed and world-anchored 3D content natively; React Native draws 2D HUD on top. `expo-camera` is only for the non-AR fallback paths, and the two never run on the same screen at once. If asked to composite AR over `expo-camera`, explain this rather than producing broken code.

## Keep the contract identical across Swift and Kotlin

Both platforms must emit **byte-for-byte identical** event names and payload keys, and accept identical prop/function signatures. Drift between Swift and Kotlin is the #1 "event never fires" bug. The canonical contract lives in `src/ExpoAr.types.ts` — change it there first, then make both native sides match.

- Units are **meters** internally; convert to display units only at the UI edge.
- Poses/transforms cross the bridge as a **16-number, column-major** array (4×4), identically on both platforms.

## Build / test workflow

```sh
npm install
npm run build      # compile TypeScript (internal/module_scripts/build.js)
npm run lint       # eslint src/
npm test           # jest (jest-expo preset)
```

- Develop against the **`example/`** app.
- **Test on physical devices only** — ARKit/ARCore do not run in the iOS Simulator or Android emulator.
- **Expo Go cannot run this** (native code) — use a development build (EAS Build or local).
- Get a **blank, tracking AR view** rendering on both platforms (with `onReady` + `onTrackingStateChange` firing) before adding any feature logic; this isolates module wiring from feature bugs.

## Session lifecycle discipline

The AR session is a resource with strict ownership — the top source of crashes and battery drain:

- **Pause on blur/background, resume on focus.** iOS: hook `viewWillDisappear` / `willResignActive`. Android: tie to the host lifecycle.
- **One AR session at a time, app-wide.** Two AR views — or an AR view plus `expo-camera`/VisionCamera — will fight over the camera.
- **`reset()` clears anchors and restarts tracking.** Offer it as a "start over" affordance.
- **Don't act before tracking is `normal`** — raycasts during `initializing`/`limited` return garbage.

## Conventions

- TypeScript throughout; formatting via Prettier (`.prettierrc`), linting via `eslint-config-universe` (`eslint.config.cjs`).
- Don't send camera frames over the JS bridge — run CV natively and emit only results.
- On Android, depth is **opt-in**: without `setDepthMode(AUTOMATIC)` there are no depth hits.

## Deeper references

The bundled skills are the authoritative deep-dives:

- `.agents/skills/expo-ar/` — the AR contract, iOS ARKit core, Android ARCore core, config plugin, and worked examples (measurement, object placement).
- `.agents/skills/expo-module/` — the Expo Modules API (module/view DSL, lifecycle, config plugins, autolinking).
