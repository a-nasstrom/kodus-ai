---
name: business-rules-validation
description: Use when asked for business validation, acceptance-criteria validation, PR-vs-task checks, or merge readiness with task compliance. Run `kodus pr business-validation` against local diff scope and optional task context.
---

# Business Rules Validation

## Goal

Run Kodus business-rules validation from local repository diff scope and optional task reference.

## Workflow

1) Ensure Kodus CLI is available.
- Run `kodus --help` to confirm.
- If missing, ask the user to install the CLI and stop.

2) Ensure authentication if required.
- If command fails with auth, run `kodus auth login` (interactive) and retry.
- For team keys, use `kodus auth team-key --key <key>` when provided by the user.

3) Choose local diff scope.
- Default (no scope flags): working tree diff.
- Optional explicit scope: `--staged`, `--branch <name>`, `--commit <sha>`, or `[files...]`.
- Use only one scope per command.

4) Run business validation.
- Examples:
```bash
kodus pr business-validation --staged --task-id KC-1441
kodus pr business-validation --branch main --task-id KC-1441
kodus pr business-validation src/service.ts src/use-case.ts --task-id KC-1441
```

5) Interpret and apply.
- Parse output and identify mismatches against requirements.
- Apply focused changes.
- Re-run the same command until output is acceptable.

## Notes

- Use `--task-id` or `--task-url` when available.
- `kodus review` and business validation are different flows.
