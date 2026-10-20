// tsc only emits .ts -> .js; the renderer's static assets (index.html,
// styles.css) need a plain copy into dist/renderer alongside renderer.js.
import { copyFileSync } from "node:fs";

for (const file of ["index.html", "styles.css"]) {
  copyFileSync(`src/renderer/${file}`, `dist/renderer/${file}`);
}
