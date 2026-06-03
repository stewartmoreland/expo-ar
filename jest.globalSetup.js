// Force Expo's winter runtime to use React Native's fetch instead of installing the
// native expo/fetch polyfill. Under jest-expo the `ExpoFetchModule.NativeResponse`
// native class is unmocked, so loading `expo/src/winter/fetch` evaluates
// `class FetchResponse extends undefined` and throws "Super expression must either be
// null or a function" during preset setup. We never exercise fetch in these contract
// tests. Set here (main process, before workers fork) so every worker inherits it —
// per-worker setupFiles run too late, after the preset has already loaded the runtime.
module.exports = async () => {
  process.env.EXPO_PUBLIC_USE_RN_FETCH = '1';
};
