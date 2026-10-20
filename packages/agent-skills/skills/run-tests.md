---
id: skill.run_tests
trigger_summary: "Run the project's test suite and report whether it passed"
origin: human
---
# Run Tests

1. Run `shell.exec` with `npm test` (allowlisted — see `packages/agent-tools/src/builtin/shell-exec.ts`).
2. If the command exits non-zero, report the failing test output back to the user rather than retrying blindly.
3. If it passes, report a short summary (suite name, pass count) rather than echoing the full raw output.
