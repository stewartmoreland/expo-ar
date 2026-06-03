// Public barrel for expo-ar. The native module + view resolve to ExpoArModule.ts on
// native platforms and ExpoArModule.web.ts on web (no-AR degradation stub).
import { Capabilities } from './ExpoAr.types';
import ExpoArModule from './ExpoArModule';

/**
 * Synchronous capability probe. Call this before mounting <ExpoArView/> and branch to a
 * non-AR fallback when `arSupported` is false (always the case on web). Validates the
 * native payload so a contract mismatch fails loudly.
 */
export function getCapabilities(): Capabilities {
  return Capabilities.parse(ExpoArModule.getCapabilities());
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
