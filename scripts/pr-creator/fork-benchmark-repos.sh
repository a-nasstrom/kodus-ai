#!/usr/bin/env bash
set -eo pipefail

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
#   3. Push all branches to the fork (in batches to avoid GitHub workflow limits)
#   4. Update the existing prs.json with the target org

SOURCE_ORG="ai-code-review-evaluation"
TARGET_ORG="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# source-repo:target-name pairs
REPOS="sentry-greptile:sentry
cal.com-greptile:cal.com
grafana-greptile:grafana-codex
keycloak-greptile:keycloak
discourse-greptile:discourse-cursor"

if [[ -z "$TARGET_ORG" ]]; then
    echo "Usage: $0 <target-org>"
    exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "Forking benchmark repos into ${TARGET_ORG}"
echo "   Working directory: ${WORKDIR}"
echo ""

echo "$REPOS" | while IFS=: read -r SRC_REPO TARGET_NAME; do
    SRC_FULL="${SOURCE_ORG}/${SRC_REPO}"
    TARGET_FULL="${TARGET_ORG}/${TARGET_NAME}"

    echo "-------------------------------------------"
    echo "${SRC_FULL} -> ${TARGET_FULL}"
    echo ""

    # Check if fork already exists
    if gh repo view "$TARGET_FULL" &>/dev/null; then
        echo "   ${TARGET_FULL} already exists, syncing branches..."
    else
        echo "   Creating fork..."

        TARGET_TYPE=$(gh api "users/${TARGET_ORG}" --jq '.type' 2>/dev/null || echo "User")

        if [[ "$TARGET_TYPE" == "Organization" ]]; then
            gh repo fork "$SRC_FULL" --org "$TARGET_ORG" --fork-name "$TARGET_NAME" --clone=false
        else
            gh repo fork "$SRC_FULL" --fork-name "$TARGET_NAME" --clone=false 2>/dev/null || true
        fi

        echo "   Fork created"
        echo "   Waiting for fork to be ready..."
        for i in $(seq 1 30); do
            if gh repo view "$TARGET_FULL" &>/dev/null; then break; fi
            sleep 2
        done
    fi

    echo "   Cloning source repo..."
    CLONE_DIR="${WORKDIR}/${TARGET_NAME}"
    git clone --bare "https://github.com/${SRC_FULL}.git" "$CLONE_DIR" 2>/dev/null

    BRANCH_COUNT=$(git -C "$CLONE_DIR" branch -a | wc -l | tr -d ' ')
    echo "   Found ${BRANCH_COUNT} branches"

    echo "   Pushing branches to fork (one by one to avoid GitHub workflow timeouts)..."
    git -C "$CLONE_DIR" remote add fork "https://github.com/${TARGET_FULL}.git"
    
    # Push tags first
    git -C "$CLONE_DIR" push fork --tags --force 2>/dev/null || true

    # Extract all branches and push them individually
    for branch in $(git -C "$CLONE_DIR" branch -a | grep -v HEAD | sed 's|^\* ||' | sed 's|^ *||'); do
        # Convert branch name to handle local bare repo refs
        clean_branch=$(echo "$branch" | sed 's|^refs/heads/||')
        echo "      Pushing $clean_branch..."
        git -C "$CLONE_DIR" push fork "$clean_branch:$clean_branch" --force 2>/dev/null || echo "      ⚠️ Failed to push $clean_branch"
    done

    echo "   Done: https://github.com/${TARGET_FULL}"
    echo ""
done

echo "-------------------------------------------"
echo "All repos forked and synced!"
echo ""

# Generate/Update prs.json with the target org
PRS_FILE="${SCRIPT_DIR}/prs.json"

if [[ -f "$PRS_FILE" ]]; then
    echo "Updating existing prs.json to use org '${TARGET_ORG}'..."
    # Create a temporary file
    TMP_JSON=$(mktemp)
    # Replace the org name in the "repo" field. Example: "ai-code-review-benchmark/sentry" -> "Wellington01/sentry"
    sed -E "s|\"repo\": \"[^/]+/|\"repo\": \"${TARGET_ORG}/|g" "$PRS_FILE" > "$TMP_JSON"
    mv "$TMP_JSON" "$PRS_FILE"
    
    PR_COUNT=$(grep -c '"head"' "$PRS_FILE")
    echo "Updated prs.json (${PR_COUNT} PRs pointing to ${TARGET_ORG})"
else
    echo "WARNING: prs.json not found. Please create it manually."
fi

echo ""
echo "Ready! Run './create-test-prs.mjs' to create the benchmark PRs."
