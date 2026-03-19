#!/usr/bin/env bash
set -euo pipefail

# Fork benchmark repos into a target GitHub org, preserving ALL branches.
#
# Usage:
#   ./fork-benchmark-repos.sh <target-org>
#
# Example:
#   ./fork-benchmark-repos.sh my-company
#
# Requirements:
#   - gh CLI authenticated
#   - git CLI available
#
# The script will:
#   1. Fork each repo into <target-org> (if not already forked)
#   2. Clone the source repo with all branches
#   3. Push all branches to the fork

SOURCE_ORG="ai-code-review-evaluation"
TARGET_ORG="${1:-}"

# Repo names in source org → name in target org
declare -A REPOS=(
    ["sentry-greptile"]="sentry"
    ["cal.com-greptile"]="cal.com"
    ["grafana-greptile"]="grafana-codex"
    ["keycloak-greptile"]="keycloak"
    ["discourse-greptile"]="discourse-cursor"
)

if [[ -z "$TARGET_ORG" ]]; then
    echo "Usage: $0 <target-org>"
    echo ""
    echo "Example: $0 my-company"
    echo ""
    echo "This will fork the benchmark repos into the specified GitHub org"
    echo "with ALL branches preserved."
    echo ""
    echo "Source repos (${SOURCE_ORG}):"
    for src in "${!REPOS[@]}"; do
        echo "  ${SOURCE_ORG}/${src} → ${TARGET_ORG:-<target-org>}/${REPOS[$src]}"
    done
    exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "🔧 Forking benchmark repos into ${TARGET_ORG}"
echo "   Working directory: ${WORKDIR}"
echo ""

for SRC_REPO in "${!REPOS[@]}"; do
    TARGET_NAME="${REPOS[$SRC_REPO]}"
    SRC_FULL="${SOURCE_ORG}/${SRC_REPO}"
    TARGET_FULL="${TARGET_ORG}/${TARGET_NAME}"

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📦 ${SRC_FULL} → ${TARGET_FULL}"
    echo ""

    # Check if fork already exists
    if gh repo view "$TARGET_FULL" &>/dev/null; then
        echo "   ℹ️  ${TARGET_FULL} already exists, syncing branches..."
    else
        echo "   🍴 Creating fork..."
        gh repo fork "$SRC_FULL" --org "$TARGET_ORG" --fork-name "$TARGET_NAME" --clone=false
        echo "   ✅ Fork created"

        # Wait for GitHub to finish creating the fork
        echo "   ⏳ Waiting for fork to be ready..."
        for i in $(seq 1 30); do
            if gh repo view "$TARGET_FULL" &>/dev/null; then
                break
            fi
            sleep 2
        done
    fi

    # Clone source with all branches
    echo "   📥 Cloning source repo (all branches)..."
    CLONE_DIR="${WORKDIR}/${TARGET_NAME}"
    git clone --bare "https://github.com/${SRC_FULL}.git" "$CLONE_DIR" 2>/dev/null

    # Count branches
    BRANCH_COUNT=$(git -C "$CLONE_DIR" branch -a | wc -l | tr -d ' ')
    echo "   📊 Found ${BRANCH_COUNT} branches"

    # Add fork as remote and push all branches
    echo "   📤 Pushing all branches to fork..."
    git -C "$CLONE_DIR" remote add fork "https://github.com/${TARGET_FULL}.git"
    git -C "$CLONE_DIR" push fork --all --force 2>&1 | tail -5
    git -C "$CLONE_DIR" push fork --tags --force 2>/dev/null || true

    echo "   ✅ Done: https://github.com/${TARGET_FULL}"
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 All repos forked and synced!"
echo ""
echo "Repos created:"
for SRC_REPO in "${!REPOS[@]}"; do
    echo "   https://github.com/${TARGET_ORG}/${REPOS[$SRC_REPO]}"
done

# Generate prs.json with the target org from the example template
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PRS_FILE="${SCRIPT_DIR}/prs.json"
PRS_EXAMPLE="${SCRIPT_DIR}/prs-example.json"

if [[ -f "$PRS_EXAMPLE" ]]; then
    sed -E "s|\"repo\": \"[^/]+/|\"repo\": \"${TARGET_ORG}/|g" "$PRS_EXAMPLE" > "$PRS_FILE"
    echo ""
    echo "📝 Generated prs.json from prs-example.json with org '${TARGET_ORG}'"
elif [[ -f "$PRS_FILE" ]]; then
    sed -i.bak -E "s|\"repo\": \"[^/]+/|\"repo\": \"${TARGET_ORG}/|g" "$PRS_FILE"
    rm -f "${PRS_FILE}.bak"
    echo ""
    echo "📝 Updated prs.json to use org '${TARGET_ORG}'"
else
    echo ""
    echo "⚠️  prs-example.json not found — create prs.json manually."
fi

echo ""
echo "✅ Ready! Run './run.sh' to create the benchmark PRs."
