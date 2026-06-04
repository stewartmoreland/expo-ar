// Public barrel for expo-ar. The native module + view resolve to ExpoArModule.ts on
// native platforms and ExpoArModule.web.ts on web (no-AR degradation stub).
import { Capabilities, DetectorInfo } from './ExpoAr.types';
import ExpoArModule from './ExpoArModule';

/**
 * Synchronous capability probe. Call this before mounting <ExpoArView/> and branch to a
 * non-AR fallback when `arSupported` is false (always the case on web). Validates the
 * native payload so a contract mismatch fails loudly.
 */
export function getCapabilities(): Capabilities {
  return Capabilities.parse(ExpoArModule.getCapabilities());
}

/**
 * CV-fusion diagnostic: is a frame processor registered under `model`, and what's actually live
 * (e.g. "YOLOv3" vs an animal fallback)? Use it to confirm a dropped Core ML / TFLite model actually
 * loaded instead of silently falling back. Returns `{ available: false, label: '' }` on web.
 */
export function getDetectorInfo(model: string): DetectorInfo {
  return DetectorInfo.parse(ExpoArModule.getDetectorInfo(model));
}

export default ExpoArModule;
export { ExpoArView } from './ExpoArModule';
export * from './ExpoAr.types';
export * from './transform';
export {
  useArSession,
  arSessionReducer,
  initialArSessionState,
  type ArSessionState,
  type ArSessionAction,
} from './useArSession';
export { useArDetection, type ViewSize } from './useArDetection';
