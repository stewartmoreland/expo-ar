# expo-ar example

A development harness that demonstrates the [`expo-ar`](../README.md) module — one React Native AR view backed by ARKit (iOS) and ARCore (Android) — with two worked features composed on the same generic core:

- **Measure** — tap surfaces to drop points and get a live "measuring tape": per-segment length labels **pinned to the real object and tracking in 3D**, plus running distance/area in your choice of units.
- **Place** — tap surfaces to drop world-anchored 3D objects.

A glass segmented control at the top switches between them; each mode keeps its controls in a bottom action bar.

> **AR runs on real hardware only.** Neither ARKit nor ARCore works in the iOS Simulator or Android emulator, and **Expo Go cannot run this** (it needs native code). You must use a **development build** on a **physical device**.

## Run it (local dev build)

From the repository root:

```sh
npm install            # installs the module + example deps (postinstall links the module)
cd example
npx expo run:ios       # build & launch on a connected iPhone
# or
npx expo run:android   # build & launch on a connected Android device
```

This compiles the native module and installs a development build on the attached device. After the first build you can iterate on JS with Fast Refresh via `npx expo start --dev-client`.

## Run it (EAS dev build)

To build in the cloud instead of locally, link your own EAS project first — this populates `owner`/`projectId` so they're never committed to the repo:

```sh
cd example
eas init                                     # links this app to YOUR EAS project
eas build --profile development --platform ios      # or android
```

Install the resulting build on your device, then start the bundler:

```sh
npx expo start --dev-client
```

The `development` profile (see [`eas.json`](./eas.json)) produces an internal-distribution dev client. [`.easignore`](../.easignore) keeps the module's compiled JS (`build/`, `plugin/build/`) in the build archive while excluding heavy native build dirs.

## What the demos show

| Demo | Tap a surface to… | Controls |
| ---- | ----------------- | -------- |
| **Measure** | drop point 1, 2, 3… | `Add point` (drops at the reticle), `Undo`, `Clear`; chips toggle **mode** (distance / area) and **unit** (m / cm / ft / in) |
| **Place** | drop a world-anchored cube | `Place`, `Remove last`, `Clear` |

The reticle is dead-center; in Measure it shows the next point number. Aim it at a surface and either tap the screen or press the primary button.

## How it maps to the module API

The example is pure composition over the generic core — it adds no session/tracking code:

- **Tap to place** → `onTap` → `addAnchor(x, y)` raycasts and creates an anchor; `onAnchorsChange` feeds the JS state.
- **Measurement** is derived in pure TS from the anchor positions (see [`features/measurement.ts`](./features/measurement.ts)); distances are in meters, formatted only at the UI edge.
- **Object-pinned labels** use the opt-in `emitProjections` prop + `onProjection` event: the native side projects each anchor to screen space every frame, and the HUD pins a glass length chip at each segment's midpoint (see [`features/MeasurementLabels.tsx`](./features/MeasurementLabels.tsx)).
- **Undo / Clear** reuse the core's `removeAnchor` / `reset`.

## Troubleshooting

- **Black camera frame:** an AR session owns the camera exclusively — never stack the AR view over `expo-camera`. Only one is on screen at a time.
- **Taps don't place points:** move the device slowly until tracking reaches `normal` (the reticle turns mint). On Android, depth hits need `depthEnabled` (on here) and a supported device.
- **Nothing happens in a simulator/emulator:** expected — use a physical device.
