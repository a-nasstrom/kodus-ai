#!/usr/bin/env bash
# Materialize .env from .env.template by resolving 1Password refs (op://...).
#
# Usage:
#   yarn env:pull              # writes ./.env, backing up any existing file
#   yarn env:pull --force      # overwrites without backup
#   yarn env:pull --check      # validates auth + template; writes nothing
#
# Requirements:
#   - 1Password CLI (`op`) installed and signed in
#     macOS:  brew install 1password-cli
#             For zero-friction signin, enable "Connect with 1Password CLI"
#             in 1Password app → Settings → Developer.
#   - Membership in the "Kodus Dev" 1Password vault.
#
# First-time setup: scripts/env/README.md (section: Pulling values from 1Password)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEMPLATE="${REPO_ROOT}/.env.template"
OUTPUT="${REPO_ROOT}/.env"
VAULT="Kodus-Dev"

FORCE=0
CHECK_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=1 ;;
        --check) CHECK_ONLY=1 ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown arg: $arg" >&2
            exit 2
            ;;
    esac
done

# ── Preflight ────────────────────────────────────────────────────────────────

if ! command -v op >/dev/null 2>&1; then
    cat >&2 <<EOF
error: 1Password CLI (op) not installed.

  macOS:  brew install 1password-cli
  other:  https://developer.1password.com/docs/cli/get-started

Then enable "Integrate with 1Password CLI" in the 1Password desktop app
(Settings → Developer) — this is the zero-signin path most of the team uses.
EOF
    exit 1
fi

# `op whoami` returns non-zero under desktop biometric integration (no
# persistent session token — each call prompts). So we check auth
# implicitly via a lightweight vault read: if it works, we're
# authenticated AND the vault is reachable. If it fails, we can't tell
# which is which, so we print both possibilities.
if ! op vault get "$VAULT" >/dev/null 2>&1; then
    cat >&2 <<EOF
error: cannot read the "$VAULT" 1Password vault.

Either:
  - The op CLI isn't signed in. If you have the desktop app, open it and
    make sure "Integrate with 1Password CLI" is enabled (Settings → Developer).
    Otherwise: op signin
  - Or your account doesn't have access to the "$VAULT" vault. Ask an
    admin to add you.

Then re-run: yarn env:pull
EOF
    exit 1
fi

if [[ ! -f "$TEMPLATE" ]]; then
    echo "error: $TEMPLATE not found. Run \`yarn env:apply\` to regenerate it from .env.schema." >&2
    exit 1
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
    echo "ok: op CLI signed in, \"$VAULT\" vault accessible, .env.template present."
    exit 0
fi

# ── Materialize ──────────────────────────────────────────────────────────────

if [[ -f "$OUTPUT" && "$FORCE" -eq 0 ]]; then
    BACKUP="${OUTPUT}.bak.$(date +%Y%m%d-%H%M%S)"
    mv "$OUTPUT" "$BACKUP"
    echo "backed up existing .env → $(basename "$BACKUP")"
fi

# `op inject` resolves every op://... ref and writes the result. Any
# unresolved ref (missing item/field) becomes a hard error and we exit
# non-zero so the dev sees what's missing instead of a half-broken .env.
op inject --in-file "$TEMPLATE" --out-file "$OUTPUT" --force

echo "wrote $OUTPUT from .env.template (vault: $VAULT)"
