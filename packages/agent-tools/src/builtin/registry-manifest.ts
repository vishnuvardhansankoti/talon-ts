import type { ToolDefinition } from "../base/tool-definition.js";
import { FsListDirTool } from "./fs-list-dir.js";
import { FsReadFileTool } from "./fs-read-file.js";
import { ShellExecTool } from "./shell-exec.js";

export function builtinTools(projectRoot: string): ToolDefinition[] {
  return [new FsReadFileTool(projectRoot), new FsListDirTool(projectRoot), new ShellExecTool(projectRoot)];
}
