const { defineConfig } = require('eslint/config');
const universe = require('eslint-config-universe/flat/native');
const universeWeb = require('eslint-config-universe/flat/web');

module.exports = defineConfig([
  { ignores: ['build'] },
  ...universe,
  ...universeWeb,
  {
    // The contract co-declares each Zod schema as a runtime value and an inferred
    // static type under the same name (`const Foo = z.object(...)` + `type Foo =
    // z.infer<typeof Foo>`) — the standard Zod ergonomic. These live in separate TS
    // declaration spaces, so no-redeclare is a false positive here.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: { '@typescript-eslint/no-redeclare': 'off' },
  },
]);
