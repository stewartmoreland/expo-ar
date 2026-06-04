# Drop your Core ML model here

Put an **object-detection** Core ML model in this folder and rebuild — `VisionObjectProcessor`
auto-loads the first model it finds (no code change), and falls back to the zero-asset animal
detector when the folder is empty.

```plaintext
example/modules/ar-detectors/ios/Models/
└── YOLOv3.mlpackage      # or YourModel.mlmodel — any name works
```

Then:

```sh
cd example
npx expo prebuild        # re-runs pod install so the new model is bundled & compiled
npx expo run:ios         # physical device
```

## Requirements for the model

- It must be an **object-detection** model that Vision surfaces as `VNRecognizedObjectObservation`
  (boxes + labels) — e.g. **YOLOv3** from Apple's [Core ML model gallery](https://developer.apple.com/machine-learning/models/),
  or a model trained with **Create ML → Object Detection**. Plain image *classifiers* won't produce
  boxes and won't work with this processor.
- `.mlmodel` and `.mlpackage` are both fine; Xcode compiles them to `.mlmodelc` at build time
  (bundled via `ArDetectors.podspec` → `resource_bundles['ArDetectorsModels']`).

This folder is committed (it survives `expo prebuild`); the gitignored `ios/` app project is not, so
**do not** drop models into `example/ios/` — they'd be wiped on the next prebuild.
