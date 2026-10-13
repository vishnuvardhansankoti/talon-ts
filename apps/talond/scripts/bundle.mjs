// Bundles the ESM dist/main.js (plus its workspace + npm deps, resolving
// pnpm's symlinked node_modules) into a single CJS file. @yao-pkg/pkg's
// snapshotting is unreliable against multi-file ESM + pnpm symlinks, so
// this bundling step has to happen first (PRD §7.3's pkg-size risk).
import { buildSync } from "esbuild";

buildSync({
  entryPoints: ["dist/main.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "pkg-build/bundle.cjs",
});
