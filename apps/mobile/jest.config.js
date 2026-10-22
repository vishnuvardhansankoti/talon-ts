// Separate from the rest of the monorepo's jest.config.mjs (ts-jest/ESM,
// matching how packages/* actually build via `tsc -b`): this app is never
// compiled by tsc at all, it's bundled by Metro through babel-preset-expo
// (see tsconfig.json's comment). Testing it through the same babel
// pipeline Metro actually uses — via jest-expo, Expo's own preset — is
// more honest than shoehorning ts-jest's Node-ESM mode onto RN source,
// and is what lets react-native/expo-* imports resolve at all; a plain
// ts-jest project has no transform for their untranspiled, Flow-typed
// node_modules sources. Given a per-directory config to load (rather than
// an inline object in the root config), Jest resolves `jest-expo` from
// this package's own node_modules, where pnpm actually installs it.
module.exports = {
  preset: "jest-expo",
  rootDir: __dirname,
  testMatch: ["<rootDir>/test/**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
