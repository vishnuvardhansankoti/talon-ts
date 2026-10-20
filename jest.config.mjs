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

export default {
  projects: [
    esmTsProject("agent-core", "packages/agent-core"),
    esmTsProject("agent-memory", "packages/agent-memory"),
    esmTsProject("agent-skills", "packages/agent-skills"),
    esmTsProject("agent-tools", "packages/agent-tools"),
    esmTsProject("agent-providers", "packages/agent-providers"),
  ],
};
