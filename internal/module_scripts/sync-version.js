#!/usr/bin/env node
// Propagate the package.json version (bumped by release-it) into the native version
// strings that don't read from package.json. Run from release-it's `after:bump` hook so
// the iOS podspec, Android Gradle module, and config-plugin dedup key stay in lockstep
// with the npm version on every release. Fails loudly if any target pattern is missing,
// so a refactor that moves a version string can't silently let the platforms drift.
const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error(`sync-version: expected a semver argument, got: ${JSON.stringify(version)}`);
  process.exit(1);
}

const root = path.join(__dirname, '..', '..');

// Each edit asserts exactly one replacement so a moved/renamed version string surfaces
// here instead of shipping a stale native version.
const edits = [
  {
    file: 'plugin/src/index.ts',
    pattern: /(const PLUGIN_VERSION = ')[^']*(')/,
  },
  {
    file: 'ios/ExpoAr.podspec',
    pattern: /(s\.version\s*=\s*')[^']*(')/,
  },
  {
    file: 'android/build.gradle',
    pattern: /(^version\s*=\s*')[^']*(')/m,
  },
  {
    file: 'android/build.gradle',
    pattern: /(versionName\s+")[^"]*(")/,
  },
];

for (const { file, pattern } of edits) {
  const abs = path.join(root, file);
  const before = fs.readFileSync(abs, 'utf8');
  if (!pattern.test(before)) {
    console.error(`sync-version: pattern ${pattern} not found in ${file}`);
    process.exit(1);
  }
  const after = before.replace(pattern, `$1${version}$2`);
  if (after !== before) {
    fs.writeFileSync(abs, after);
    console.log(`sync-version: ${file} -> ${version}`);
  }
}
