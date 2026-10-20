import { watch as fsWatch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../base/tool-definition.js";
import { loadToolsFromYaml, type ToolConfigHandle } from "./loader.js";

export interface WatchToolsOptions {
  readonly secretsPath?: string;
  readonly debounceMs?: number;
  readonly onReload?: (tools: readonly ToolDefinition[]) => void;
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_DEBOUNCE_MS = 300;

interface WatchTarget {
  readonly watchPath: string;
  readonly matches: (filename: string | null) => boolean;
}

/**
 * `fs.watch` on a single file's exact path can stop tracking it across an
 * atomic save (write-temp-file-then-rename, which most editors do) on some
 * platforms, because the watch is tied to the original inode. Watching the
 * *parent directory* and filtering by basename survives that; for a
 * directory config (§7 follow-up), every change within it is relevant
 * since the file set itself can change.
 */
async function resolveWatchTarget(configPath: string): Promise<WatchTarget> {
  const stats = await stat(configPath);
  if (stats.isDirectory()) {
    return { watchPath: configPath, matches: () => true };
  }
  const basename = path.basename(configPath);
  return {
    watchPath: path.dirname(configPath),
    // A null filename (platform-dependent) can't be compared — treat it
    // as relevant rather than risk silently ignoring a real change.
    matches: (filename) => filename === null || filename === basename,
  };
}

/**
 * §7 follow-up: hot reload. Loads once up front — failing fast exactly
 * like `loadToolsFromYaml`, since a broken *startup* config should stop
 * the app the same way it always has. From then on, a change to
 * `configPath` triggers a reload; a reload that fails to parse/validate
 * is reported via `onError` and the previously active tool set (and its
 * live mcp connections) keeps serving unchanged — a bad edit to a
 * *running* daemon's config must never take it down.
 *
 * A successful reload connects the new tool set fully (including any new
 * `mcp` entries) before closing the previous one's connections, so there
 * is no gap where no connection is live.
 */
export async function watchToolsFromYaml(
  configPath: string,
  projectRoot: string,
  options: WatchToolsOptions = {},
): Promise<ToolConfigHandle> {
  const initial = await loadToolsFromYaml(configPath, projectRoot, options.secretsPath);

  let active: ToolConfigHandle = initial;
  let closed = false;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;

  async function reload(): Promise<void> {
    if (closed) return;

    let next: ToolConfigHandle;
    try {
      next = await loadToolsFromYaml(configPath, projectRoot, options.secretsPath);
    } catch (error) {
      options.onError?.(error);
      return;
    }

    if (closed) {
      // close() ran while the reload above was in flight — the new
      // connections were never meant to outlive it.
      await next.close();
      return;
    }

    const previous = active;
    active = next;
    await previous.close();

    try {
      options.onReload?.(next.tools);
    } catch (error) {
      options.onError?.(error);
    }
  }

  function scheduleReload(): void {
    if (closed) return;
    if (reloadTimer !== undefined) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reload(), options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  const { watchPath, matches } = await resolveWatchTarget(configPath);
  const watcher: FSWatcher = fsWatch(watchPath, { persistent: true }, (_eventType, filename) => {
    if (matches(filename)) scheduleReload();
  });
  watcher.on("error", (error) => options.onError?.(error));

  return {
    tools: initial.tools,
    close: async () => {
      if (closed) return;
      closed = true;
      if (reloadTimer !== undefined) clearTimeout(reloadTimer);
      watcher.close();
      await active.close();
    },
  };
}
