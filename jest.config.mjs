const esmTsProject = (displayName, rootDir) => ({
  displayName,
  rootDir,
  testEnvironment: "node",
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: `${rootDir}/tsconfig.json` }],
  },
  testMatch: ["**/test/**/*.test.ts"],
});

// apps/mobile is tested separately (`pnpm --filter @talon/mobile run
// test`), not folded in as a project here: it needs jest-expo's
// babel-based transform (matching how Metro actually bundles it), not
// ts-jest, and nesting a jest-expo project under this root config's
// multi-project resolution broke `@babel/runtime` module resolution in a
// way that only reproduced when run from here — reliably clean when run
// standalone from apps/mobile's own directory, where pnpm's workspace
// node_modules layout resolves it correctly.
export default {
  projects: [
    esmTsProject("agent-core", "packages/agent-core"),
    esmTsProject("agent-memory", "packages/agent-memory"),
    esmTsProject("agent-skills", "packages/agent-skills"),
    esmTsProject("agent-tools", "packages/agent-tools"),
    esmTsProject("agent-providers", "packages/agent-providers"),
    esmTsProject("desktop", "apps/desktop"),
  ],
};
