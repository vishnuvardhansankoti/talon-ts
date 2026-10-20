// Monorepo wiring: @talon/agent-core and @talon/agent-providers are pnpm
// workspace symlinks, not real node_modules entries. Metro needs to watch
// the workspace root (so edits to those packages' dist/ output trigger a
// rebuild) and know where their *own* node_modules might live, on top of
// this app's local node_modules — the standard two-line fix for pnpm/yarn
// workspaces documented in Expo's own monorepo guide.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
