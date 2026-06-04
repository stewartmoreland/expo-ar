# Custom Android model (optional)

`MlKitObjectProcessor` uses ML Kit's **bundled** object detector by default — **no asset needed**, so
Android works out of the box (coarse 5-category labels).

To test a **custom** TFLite/LiteRT object-detection model instead, drop it here:

```plaintext
example/modules/ar-detectors/android/src/main/assets/
└── model.tflite
```

Then make two changes in this local module:

1. **`android/build.gradle`** — swap the dependency for the custom-model variant:

   ```gradle
   implementation 'com.google.mlkit:object-detection-custom:17.0.2'
   ```

2. **`MlKitObjectProcessor.kt`** — build the detector from the asset:

   ```kotlin
   import com.google.mlkit.common.model.LocalModel
   import com.google.mlkit.vision.objects.custom.CustomObjectDetectorOptions

   private val localModel = LocalModel.Builder().setAssetFilePath("model.tflite").build()
   private val detector = ObjectDetection.getClient(
     CustomObjectDetectorOptions.Builder(localModel)
       .setDetectorMode(CustomObjectDetectorOptions.STREAM_MODE)
       .enableClassification()
       .enableMultipleObjects()
       .build()
   )
   ```

Rebuild with `npx expo prebuild && npx expo run:android`. This folder is committed and survives
prebuild; the gitignored `android/` app project is not — don't drop models into `example/android/`.
