# Build config — module scaffold, config plugin, prebuild

Module scaffold, the config plugin that injects iOS/Android AR config, `app.json`, and the build/run flow. AR needs native code, so **Expo Go is out** — use a development build.

## 1. Scaffold the local module

```bash
npx create-expo-module@latest --local expo-ar
```

Generates an autolinked module under `modules/`. Target layout once the core + examples are in:

```
modules/expo-ar/
├── expo-module.config.json     # registers iOS/Android module classes
├── index.ts                    # getCapabilities + re-exports        (js-contract.md)
├── src/
│   ├── ExpoArView.tsx          # requireNativeViewManager wrapper     (js-contract.md)
│   ├── useArSession.ts         # generic session hook                 (js-contract.md)
│   ├── transform.ts            # pose/transform helpers               (js-contract.md)
│   ├── types.ts                # Zod core contract                    (js-contract.md)
│   └── features/               # one folder per use case (optional)
│       ├── measurement.ts      # measurement hook + math + types      (examples/measurement.md)
│       └── placement.ts        # placement hook + types               (examples/object-placement.md)
├── ios/
│   ├── ExpoArModule.swift                              (ios-arkit.md)
│   └── ExpoArView.swift        # open class; features extend it       (ios-arkit.md)
└── android/
    ├── build.gradle            # ARCore + SceneView deps              (android-arcore.md)
    └── src/main/java/expo/modules/ar/
        ├── ExpoArModule.kt                             (android-arcore.md)
        └── ExpoArView.kt       # open class; features extend it       (android-arcore.md)
```

`expo-module.config.json`:

```json
{
  "platforms": ["ios", "android"],
  "ios": { "modules": ["ExpoArModule"] },
  "android": { "modules": ["expo.modules.ar.ExpoArModule"] }
}
```

Make a **standalone** npm package (drop `--local`) only if `expo-ar` will be reused across apps; for one app, local autolinks the same way.

## 2. The config plugin

No third-party ARCore plugin needed — write a small one. It sets the iOS camera usage string, the Android camera permission, the ARCore `meta-data` + `uses-feature`, and optionally marks AR as required for store filtering.

`modules/expo-ar/plugin/withExpoAr.js`:

```js
const {
  withInfoPlist, withAndroidManifest, AndroidConfig, createRunOncePlugin,
} = require('expo/config-plugins');

/**
 * @param {object} config
 * @param {object} [props]
 * @param {string}  [props.cameraPermission] iOS NSCameraUsageDescription text
 * @param {boolean} [props.arRequired] true => only installs on AR-capable devices
 */
const withExpoAr = (config, props = {}) => {
  const cameraPermission = props.cameraPermission ?? 'This app uses the camera for augmented reality.';
  const arRequired = props.arRequired ?? false;

  config = withInfoPlist(config, (c) => {
    c.modResults.NSCameraUsageDescription = cameraPermission;
    if (arRequired) {
      const caps = new Set(c.modResults.UIRequiredDeviceCapabilities || []);
      caps.add('arkit');
      c.modResults.UIRequiredDeviceCapabilities = [...caps];
    }
    return c;
  });

  config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.CAMERA']);

  config = withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    const manifest = c.modResults.manifest;

    app['meta-data'] = app['meta-data'] || [];
    if (!app['meta-data'].some((m) => m.$['android:name'] === 'com.google.ar.core')) {
      app['meta-data'].push({
        $: { 'android:name': 'com.google.ar.core', 'android:value': arRequired ? 'required' : 'optional' },
      });
    }

    manifest['uses-feature'] = manifest['uses-feature'] || [];
    if (!manifest['uses-feature'].some((f) => f.$['android:name'] === 'android.hardware.camera.ar')) {
      manifest['uses-feature'].push({
        $: { 'android:name': 'android.hardware.camera.ar', 'android:required': String(arRequired) },
      });
    }
    return c;
  });

  return config;
};

module.exports = createRunOncePlugin(withExpoAr, 'expo-ar', '1.0.0');
```

`required` vs `optional`: `optional` lets the app install on non-AR devices (so the `expo-camera` fallback is reachable) and fetches ARCore on demand; `required` filters to AR-capable devices and bundles ARCore. Default `optional` unless the app is AR-only.

## 3. `app.json`

```json
{
  "expo": {
    "plugins": [
      ["./modules/expo-ar/plugin/withExpoAr", {
        "cameraPermission": "Allow $(PRODUCT_NAME) to use the camera for AR.",
        "arRequired": false
      }]
    ],
    "ios": { "deploymentTarget": "15.0" },
    "android": { "minSdkVersion": 24 }
  }
}
```

## 4. Build & run

```bash
npx expo prebuild --clean
npx expo run:ios --device        # ARKit needs a physical device
npx expo run:android --device    # ARCore needs a physical device
# or: eas build --profile development --platform ios|android
```

Any Swift/Kotlin change requires a native rebuild (Fast Refresh only reloads JS). Re-run `npx pod-install` (iOS) after adding native files or editing `expo-module.config.json`.

## Checklist before first run

- [ ] **Physical devices** only (simulator/emulator can't do AR).
- [ ] `expo-module.config.json` lists both module classes.
- [ ] Android `build.gradle`: `com.google.ar:core` + renderer dep; `minSdkVersion ≥ 24`.
- [ ] iOS `deploymentTarget ≥ 13.4` for LiDAR mesh APIs (15 is a safe floor).
- [ ] Swift and Kotlin emit identical event names + payload keys (`types.ts`).
- [ ] `getCapabilities()` branches to the fallback before mounting the AR view.
- [ ] Session pause/resume wired to screen focus/blur.
