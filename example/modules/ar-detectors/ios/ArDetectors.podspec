Pod::Spec.new do |s|
  s.name           = 'ArDetectors'
  s.version        = '1.0.0'
  s.summary        = 'Example CV frame processors (Apple Vision) registered into expo-ar'
  s.description    = 'Demonstrates the expo-ar CV-fusion provider seam: a native frame processor ' \
                     'that runs on the AR session frames and emits detections. Example app only.'
  s.author         = 'expo-ar example'
  s.homepage       = 'https://github.com/stewartmoreland/expo-ar'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The provider seam (ExpoArFrameProcessor + ExpoArDetectorRegistry) lives in the expo-ar pod.
  s.dependency 'ExpoAr'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"

  # Drop a Core ML object-detection model (.mlmodel / .mlpackage) into ios/Models/ and Xcode
  # compiles it to .mlmodelc inside the ArDetectorsModels.bundle at build time. VisionObjectProcessor
  # auto-loads the first model it finds there (else falls back to the zero-asset animal detector).
  s.resource_bundles = {
    'ArDetectorsModels' => ['Models/*.mlmodel', 'Models/*.mlpackage']
  }
end
