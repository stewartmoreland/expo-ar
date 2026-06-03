// Reexport the native module. On web, it will be resolved to ExpoArModule.web.ts
// and on native platforms to ExpoArModule.ts
export { default } from './ExpoArModule';
export * from './ExpoAr.types';
