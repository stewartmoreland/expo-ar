// Config plugin entry point. Expo resolves `expo-ar`'s plugin from this file at the
// package root; it re-exports the compiled plugin from plugin/build (built by
// `npm run build plugin`). Keep this file plain JS — it must run without compilation.
module.exports = require('./plugin/build');
