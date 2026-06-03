import { NativeModule, requireNativeModule, requireNativeView } from 'expo';
import * as React from 'react';

import type { ArViewHandle, Capabilities, ExpoArViewProps } from './ExpoAr.types';

type ExpoArModuleEvents = Record<never, never>;

declare class ExpoArModule extends NativeModule<ExpoArModuleEvents> {
  getCapabilities(): Capabilities;
}

const NativeModuleInstance = requireNativeModule<ExpoArModule>('ExpoAr');

// The native runtime attaches the view-level AsyncFunctions (raycast, addAnchor, …)
// to the imperative ref. `requireNativeView` doesn't type them, so we widen the ref
// to ArViewHandle for consumers. (createElement, not JSX, keeps this a .ts file.)
const NativeView = requireNativeView<ExpoArViewProps>('ExpoAr') as React.ComponentType<
  ExpoArViewProps & React.RefAttributes<ArViewHandle>
>;

export const ExpoArView = React.forwardRef<ArViewHandle, ExpoArViewProps>((props, ref) =>
  React.createElement(NativeView, { ...props, ref })
);

ExpoArView.displayName = 'ExpoArView';

export default NativeModuleInstance;
