import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { ProfileCapExceededError, ProfileWriter } from "../src/profile/profile-writer.js";

async function tempProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "talon-memory-profile-"));
}

describe("ProfileWriter", () => {
  it("returns undefined when USER.md doesn't exist yet", async () => {
    const writer = new ProfileWriter(await tempProjectRoot());
    expect(await writer.load()).toBeUndefined();
  });

  it("round-trips a write/load", async () => {
    const writer = new ProfileWriter(await tempProjectRoot());
    await writer.write("# User Profile\n\n## Identity\n- Name: Test User\n");
    expect(await writer.load()).toContain("Test User");
  });

  it("rejects (never truncates) a write exceeding the 2,000-token cap", async () => {
    const writer = new ProfileWriter(await tempProjectRoot());
    await writer.write("short profile, well within the cap");

    const tooLong = "x".repeat(9_000); // ~2,250 tokens at chars/4
    await expect(writer.write(tooLong)).rejects.toBeInstanceOf(ProfileCapExceededError);

    // The rejected write must not have partially overwritten the file.
    expect(await writer.load()).toContain("short profile, well within the cap");
  });

  it("accepts a write right at the cap boundary", async () => {
    const writer = new ProfileWriter(await tempProjectRoot());
    // Frontmatter adds some overhead, so keep comfortably under 2000*4 chars
    // for the body alone while still exercising a large-but-valid write.
    const body = "x".repeat(6_000); // ~1,500 tokens
    await expect(writer.write(body)).resolves.toBeUndefined();
    expect(await writer.load()).toContain(body);
  });
});
