Pod::Spec.new do |s|
  s.name           = 'ExpoAr'
  s.version        = '0.2.2'
  s.summary        = 'Augmented Reality module bridging iOS ARKit and Android ARCore'
  s.description    = 'A single React Native AR view backed by ARKit (iOS) and ARCore (Android) behind one shared TypeScript contract.'
  s.author         = 'Stewart Moreland'
  s.homepage       = 'https://github.com/stewartmoreland/expo-ar'
  s.license        = { :type => 'MIT', :file => '../LICENSE' }
  # ARKit world tracking is iOS-only; 15.0 is a safe floor that still covers the
  # LiDAR scene-reconstruction APIs (available since 13.4).
  s.platforms      = {
    :ios => '15.0'
  }
  s.source         = { git: 'https://github.com/stewartmoreland/expo-ar.git', tag: "v#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
