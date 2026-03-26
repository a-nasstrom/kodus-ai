#!/bin/bash
#
# Step 1: Create benchmark PRs
#
# Usage:
#   ./benchmark-create.sh <name> [TOTAL_PRS]
#
# Examples:
#   ./benchmark-create.sh sonnet-v1 20
#   ./benchmark-create.sh kimi-baseline 50
#   ./benchmark-create.sh test-run        # default: 20 PRs
#
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./benchmark-create.sh <name> [TOTAL_PRS]"
  echo ""
  echo "Examples:"
  echo "  ./benchmark-create.sh sonnet-v1 20"
  echo "  ./benchmark-create.sh kimi-baseline"
  echo ""
  # List existing runs
  RUNS_DIR="$(cd "$(dirname "$0")" && pwd)/runs"
  if [ -d "$RUNS_DIR" ] && [ "$(ls -A "$RUNS_DIR" 2>/dev/null)" ]; then
    echo "Existing runs:"
    for f in "$RUNS_DIR"/*.json; do
      NAME=$(basename "$f" .json)
      PRS=$(node -e "const d=JSON.parse(require('fs').readFileSync('$f','utf8')); console.log(d.prs.length + ' PRs, created ' + d.created)" 2>/dev/null || echo "?")
      echo "  $NAME — $PRS"
    done
  fi
  exit 1
fi

RUN_NAME="$1"
TOTAL_PRS=${2:-20}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNS_DIR="$SCRIPT_DIR/runs"
mkdir -p "$RUNS_DIR"
WORKER=$(docker ps --format '{{.Names}}' | grep worker | head -1)

echo "============================================================"
echo "Benchmark — Create PRs"
echo "============================================================"
echo "Run: $RUN_NAME | PRs: $TOTAL_PRS"
echo ""

# Clean pipeline
echo "▸ Cleaning pipeline..."
docker exec db_postgres psql -U kodusdev -d kodus_db -c \
  "DELETE FROM kodus_workflow.inbox_messages WHERE status = 'PROCESSING';" -q 2>/dev/null || true
docker exec db_postgres psql -U kodusdev -d kodus_db -c \
  "DELETE FROM kodus_workflow.outbox_messages WHERE status IN ('READY','PROCESSING','FAILED');" -q 2>/dev/null || true
docker exec rabbitmq rabbitmqctl purge_queue -p kodus-ai workflow.jobs.code_review.queue 2>/dev/null || true
docker exec rabbitmq rabbitmqctl purge_queue -p kodus-ai workflow.jobs.webhook.queue 2>/dev/null || true
echo "  ✓ Pipeline cleaned"

# Restart worker
echo "▸ Restarting worker..."
docker exec $WORKER rm -rf /usr/src/app/node_modules/.cache/webpack 2>/dev/null || true
docker restart $WORKER > /dev/null 2>&1
sleep 25
COMPILED=$(docker logs $WORKER 2>&1 | grep "compiled" | tail -1)
if echo "$COMPILED" | grep -q "successfully"; then
  echo "  ✓ Worker compiled successfully"
else
  echo "  ✗ Worker compilation failed"
  exit 1
fi

# Close ALL open PRs in benchmark repos first
echo "▸ Closing all open PRs..."
for repo in sentry grafana-codex discourse-cursor cal.com keycloak; do
  OPEN_PRS=$(gh api "repos/ai-code-review-benchmark/$repo/pulls?state=open&per_page=100" --jq '.[].number' 2>/dev/null || true)
  for pr in $OPEN_PRS; do
    gh api "repos/ai-code-review-benchmark/$repo/pulls/$pr" -X PATCH -f state=closed --silent 2>/dev/null || true
  done
  COUNT=$(echo "$OPEN_PRS" | grep -c '[0-9]' 2>/dev/null || echo 0)
  [ "$COUNT" -gt 0 ] && echo "  $repo: closed $COUNT PRs"
done
echo "  ✓ All PRs closed"

# Create PRs
echo "▸ Creating $TOTAL_PRS PRs..."
cd "$REPO_DIR/scripts/pr-creator"
RESULT=$(GITHUB_TOKEN=$(gh auth token) TOTAL_PRS=$TOTAL_PRS node create-test-prs.mjs 2>&1)
CREATED=$(echo "$RESULT" | grep "Total:" | grep -o "[0-9]*")
echo "$RESULT" | grep "✅"
echo ""
echo "  ✓ Created $CREATED PRs"

# Save run manifest — maps repo/branch to PR number
cd "$REPO_DIR"
echo "▸ Building run manifest..."
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const benchmark = JSON.parse(fs.readFileSync('scripts/benchmark/prs-benchmark.json', 'utf8'));
const owner = 'ai-code-review-benchmark';
const repos = ['sentry', 'grafana-codex', 'discourse-cursor', 'cal.com', 'keycloak'];
const byRepo = {};
for (const pr of benchmark.prs) {
  const repo = pr.repo.split('/').pop();
  if (!byRepo[repo]) byRepo[repo] = [];
  byRepo[repo].push(pr);
}

const perRepo = Math.ceil($TOTAL_PRS / repos.length);
const prs = [];

// For each benchmark PR, find the actual GitHub PR by head branch
for (const repo of repos) {
  const benchPrs = (byRepo[repo] || []).slice(0, perRepo);
  // Get all open+closed PRs from this repo
  let ghPrs = [];
  try {
    ghPrs = JSON.parse(execSync(
      'gh api \"repos/' + owner + '/' + repo + '/pulls?state=all&per_page=50&sort=created&direction=desc\" --jq \"[.[] | {number, head: .head.ref}]\"',
      { encoding: 'utf8', timeout: 30000 }
    ));
  } catch {}

  for (const bpr of benchPrs) {
    const match = ghPrs.find(p => p.head === bpr.head);
    prs.push({
      repo,
      head: bpr.head,
      title: bpr.title,
      prNumber: match ? match.number : null,
    });
    const status = match ? 'PR#' + match.number : 'NOT FOUND';
    console.log('  ' + repo.padEnd(18) + bpr.head.substring(0,35).padEnd(37) + status);
  }
}

const manifest = {
  name: '$RUN_NAME',
  created: new Date().toISOString(),
  totalPrs: $TOTAL_PRS,
  prs,
};

fs.writeFileSync('$RUNS_DIR/$RUN_NAME.json', JSON.stringify(manifest, null, 2));
const mapped = prs.filter(p => p.prNumber).length;
console.log('');
console.log('Manifest: scripts/benchmark/runs/$RUN_NAME.json (' + mapped + '/' + prs.length + ' mapped)');
"

echo ""
echo "Wait for reviews to finish, then run:"
echo "  ./scripts/benchmark/benchmark-evaluate.sh $RUN_NAME"
echo ""
echo "Check progress with:"
echo "  docker logs $WORKER --since 30s 2>&1 | grep -c AGENT"
