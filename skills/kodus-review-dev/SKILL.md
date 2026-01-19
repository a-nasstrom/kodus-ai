---
name: kodus-review-dev
description: Use the local Kodus CLI alias (kodus-dev-local) to run code reviews in a dev environment and apply fixes based on CLI output. Trigger when testing Kodus CLI locally or when told to use kodus-dev-local.
---

# Kodus Review (Dev)

## Goal

Use the local Kodus CLI alias to review changes and resolve issues. Prefer machine-friendly output via `--prompt-only`, then apply fixes in code.

## Workflow

1) Ensure local dev command is available.
- Prefer the full command with env vars (do not rely on aliases).
- Use: `KODUS_API_URL="http://localhost:3001" KODUS_VERBOSE=1 node /Users/gabrielmalinosqui/dev/kodus/cli/dist/index.js --help`.
- If missing or failing, ask the user to confirm the local path and env values, then stop.

2) Ensure authentication if required.
- If the review fails with auth, run the same command with `auth login` (interactive) and retry.
- For team keys, use `auth team-key --key <key>` with the same env vars and local path when provided by the user.

3) Run review using prompt-only output.
- Default: `KODUS_API_URL="http://localhost:3001" KODUS_VERBOSE=1 node /Users/gabrielmalinosqui/dev/kodus/cli/dist/index.js review --prompt-only`.
- If user specifies files: append `<files...>`.
- If user asks for staged/commit/branch: add `--staged`, `--commit <sha>`, or `--branch <name>`.
- If user wants fast: add `--fast`.

4) Parse results and apply fixes.
- Use the output to locate files and lines.
- Make minimal, targeted changes to address each issue.
- If an issue is not actionable or is a false positive, explain why and skip.

5) Re-run review if needed.
- After fixes, rerun `kodus-dev-local review --prompt-only` to confirm issues are resolved.

## Notes

- Prefer `--prompt-only` for predictable parsing.
- Avoid `--interactive` unless the user explicitly asks.
- Do not use `--fix` unless the user explicitly asks.
