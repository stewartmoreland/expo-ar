import { NativeModule, registerWebModule } from 'expo';
import * as React from 'react';
import { View } from 'react-native';

import type { ArViewHandle, Capabilities, DetectorInfo, ExpoArViewProps } from './ExpoAr.types';

type ExpoArModuleEvents = Record<never, never>;

// Web is a no-AR degradation stub: it compiles and reports AR unsupported so a
// universal app can call getCapabilities() and branch to its non-AR fallback
// before ever mounting the view. No native AR runs on web.
class ExpoArModule extends NativeModule<ExpoArModuleEvents> {
  getCapabilities(): Capabilities {
    return { arSupported: false, depthOrLidarAvailable: false, geoTrackingSupported: false };
  }

  // No CV on web — nothing is ever registered.
  getDetectorInfo(_model: string): DetectorInfo {
    return { available: false, label: '' };
  }
}

// Renders a plain View (and never an AR session) so importing/mounting on web is safe.
// The ref intentionally exposes none of the native AsyncFunctions.
export const ExpoArView = React.forwardRef<ArViewHandle, ExpoArViewProps>((props, _ref) =>
  React.createElement(View, props)
);

ExpoArView.displayName = 'ExpoArView';

export default registerWebModule(ExpoArModule, 'ExpoArModule');
