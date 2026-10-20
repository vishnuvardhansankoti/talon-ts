import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateTokens, parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

const USER_MD_TOKEN_CAP = 2_000;

export class ProfileCapExceededError extends Error {
  constructor(tokens: number) {
    super(`USER.md write rejected: ${tokens} tokens exceeds the ${USER_MD_TOKEN_CAP}-token cap (§4.1) — consolidate first`);
    this.name = "ProfileCapExceededError";
  }
}

/** Tier 1 (§4.1): USER.md, human-editable, loaded in full into every
 * session's system context. Nothing in this pass calls `write()`
 * automatically — per the PRD it "changes rarely... only explicit
 * user-approved edits or user-initiated /forget commands mutate it," and
 * Phase 2 has no such UI/command yet. `write()` exists as a capability for
 * a future caller, with the cap enforced here regardless of who calls it. */
export class ProfileWriter {
  private readonly filePath: string;

  constructor(projectRoot: string) {
    this.filePath = path.join(projectRoot, ".talon", "USER.md");
  }

  /** Returns the body (frontmatter stripped) if USER.md exists, else `undefined`. */
  async load(): Promise<string | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    return parseFrontmatter(raw).body;
  }

  /** Rejects (never truncates) writes whose full file content — frontmatter
   * + body — would exceed the 2,000-token cap. */
  async write(body: string): Promise<void> {
    const content = serializeFrontmatter(
      { schema_version: "1", updated_at: new Date().toISOString() },
      body,
    );
    const tokens = estimateTokens(content);
    if (tokens > USER_MD_TOKEN_CAP) {
      throw new ProfileCapExceededError(tokens);
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, content, "utf8");
  }
}
