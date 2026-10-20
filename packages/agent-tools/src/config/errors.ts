/**
 * Thrown by anything in `config/` that rejects a tools.yaml file — carries
 * enough to point at the exact offending entry, since a load failure fails
 * the whole file (design doc §6) and the person editing it needs to know
 * which entry broke, not just that loading failed somewhere.
 */
export class ToolConfigError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly entryIndex: number | undefined,
    reason: string,
  ) {
    const location = entryIndex === undefined ? filePath : `${filePath}, entry ${entryIndex}`;
    super(`invalid tool config (${location}): ${reason}`);
    this.name = "ToolConfigError";
  }
}
