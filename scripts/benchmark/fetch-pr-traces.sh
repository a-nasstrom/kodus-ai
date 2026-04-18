#!/bin/bash
#
# Fetch LangSmith traces for a specific PR number
#
# Usage:
#   ./fetch-pr-traces.sh <pr_number> [options]
#
# Options:
#   --agent <name>    Filter by agent (bug, security, performance, or full name)
#   --tools           Show all tool calls with args and results
#   --verify          Show verification decisions in detail
#   --reasoning       Show full reasoning text
#   --coverage        Show coverage details per file
#   --full            Enable all options above
#   --json            Output raw JSON
#
# Examples:
#   ./fetch-pr-traces.sh 277                        # summary of all agents
#   ./fetch-pr-traces.sh 277 --agent bug            # only bug agent
#   ./fetch-pr-traces.sh 277 --tools                # show tool calls
#   ./fetch-pr-traces.sh 277 --agent bug --tools    # bug agent with tool calls
#   ./fetch-pr-traces.sh 277 --full                 # everything
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$REPO_DIR/.env" ]; then
  LANGSMITH_KEY=$(grep -E "^LANGCHAIN_API_KEY=" "$REPO_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
fi

if [ -z "${LANGSMITH_KEY:-}" ]; then
  echo "LANGCHAIN_API_KEY not found in .env"
  exit 1
fi

PR_NUMBER="${1:-}"
if [ -z "$PR_NUMBER" ]; then
  echo "Usage: ./fetch-pr-traces.sh <pr_number> [--agent <name>] [--tools] [--verify] [--reasoning] [--coverage] [--full] [--json]"
  exit 1
fi
shift

# Parse options
AGENT_FILTER=""
SHOW_TOOLS=false
SHOW_VERIFY=false
SHOW_REASONING=false
SHOW_COVERAGE=false
RAW_JSON=false

while [ $# -gt 0 ]; do
  case "$1" in
    --agent) AGENT_FILTER="$2"; shift 2 ;;
    --tools) SHOW_TOOLS=true; shift ;;
    --verify) SHOW_VERIFY=true; shift ;;
    --reasoning) SHOW_REASONING=true; shift ;;
    --coverage) SHOW_COVERAGE=true; shift ;;
    --full) SHOW_TOOLS=true; SHOW_VERIFY=true; SHOW_REASONING=true; SHOW_COVERAGE=true; shift ;;
    --json) RAW_JSON=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SESSION_ID="149d8312-f038-49f5-ad32-9ee7e3f9cdd0"

curl -s "https://api.smith.langchain.com/runs/query" \
  -X POST \
  -H "x-api-key: $LANGSMITH_KEY" \
  -H "Content-Type: application/json" \
  --data-raw "{
    \"session\": [\"$SESSION_ID\"],
    \"filter\": \"has(metadata, '{\\\"prNumber\\\": $PR_NUMBER}')\",
    \"is_root\": true,
    \"limit\": 30
  }" | python3 -c "
import json, sys

agent_filter = '$AGENT_FILTER'.lower()
show_tools = '$SHOW_TOOLS' == 'true'
show_verify = '$SHOW_VERIFY' == 'true'
show_reasoning = '$SHOW_REASONING' == 'true'
show_coverage = '$SHOW_COVERAGE' == 'true'
raw_json = '$RAW_JSON' == 'true'

data = json.load(sys.stdin)
runs = data.get('runs', [])

agents = [r for r in runs if 'review-agent' in r.get('name', '')]

# Apply agent filter
if agent_filter:
    agents = [r for r in agents if agent_filter in r.get('name', '').lower()]

if raw_json:
    print(json.dumps(agents, indent=2, default=str))
    sys.exit(0)

if not agents:
    print(f'No traces found for PR#$PR_NUMBER' + (f' (agent filter: {agent_filter})' if agent_filter else ''))
    sys.exit(0)

# Sort by start time (most recent first)
agents.sort(key=lambda r: r.get('start_time', ''), reverse=True)

# Group by batch (same start_time prefix = same run)
batches = {}
for r in agents:
    batch_key = (r.get('start_time') or '')[:16]  # group by minute
    if batch_key not in batches:
        batches[batch_key] = []
    batches[batch_key].append(r)

print(f'PR#$PR_NUMBER — {len(agents)} agent traces in {len(batches)} batch(es)')
print()

for batch_time, batch_agents in sorted(batches.items(), reverse=True):
    if len(batches) > 1:
        print(f'╔══ Batch {batch_time} ({len(batch_agents)} agents) ══╗')
        print()

    for r in batch_agents:
        name = r.get('name', '?')
        rid = r.get('id', '?')
        start = (r.get('start_time') or '?')[:19]

        inputs = r.get('inputs', {}) or {}
        outputs = r.get('outputs', {}) or {}
        extra = r.get('extra', {}) or {}

        repo = (inputs.get('repositoryFullName', '?') or '?').split('/')[-1]
        changed_files = inputs.get('changedFiles', []) or []

        tc = outputs.get('toolCalls', []) or []
        steps = outputs.get('steps', '?')
        findings = outputs.get('findings', {}) or {}
        suggs = findings.get('suggestions', []) or []
        reasoning = findings.get('reasoning', '')
        coverage = outputs.get('coverage', {}) or {}
        verification = outputs.get('verification', {}) or {}
        anomalies = outputs.get('anomalies', {}) or {}
        usage = outputs.get('usage', {}) or {}
        finish = outputs.get('finishReason', '?')
        source = outputs.get('source', '?')

        # Tool counts
        tool_counts = {}
        for t in tc:
            tn = t.get('tool', t.get('toolName', '?'))
            tool_counts[tn] = tool_counts.get(tn, 0) + 1
        tools_str = ', '.join(f'{k}:{v}' for k, v in sorted(tool_counts.items(), key=lambda x: -x[1]))

        # Coverage
        cov_total = coverage.get('totalTargets', 0)
        cov_touched = coverage.get('touchedTargets', 0)
        cov_pending = coverage.get('pendingFiles', [])
        cov_touched_files = coverage.get('touchedFiles', [])
        cov_pct = f'{100*cov_touched/cov_total:.0f}%' if cov_total > 0 else 'N/A'

        # Verification
        v_before = verification.get('beforeCount', '')
        v_after = verification.get('afterCount', '')
        v_dropped_v = verification.get('droppedByVerifier', 0)
        v_dropped_e = verification.get('droppedByEvidenceFilter', 0)

        # Print header
        agent_short = name.replace('kodus-', '').replace('-review-agent', '')
        print(f'━━━ {agent_short} ━━━')
        print(f'  Repo: {repo} | {start} | finish: {finish} | source: {source}')
        print(f'  Steps: {steps} | Tools: {len(tc)} [{tools_str}]')
        print(f'  Tokens: in={usage.get(\"inputTokens\",\"?\"):,}, out={usage.get(\"outputTokens\",\"?\"):,}, reasoning={usage.get(\"reasoningTokens\",\"?\")}')
        print(f'  Coverage: {cov_touched}/{cov_total} ({cov_pct})')

        if cov_pending:
            for pf in cov_pending:
                print(f'    ❌ MISSED: {pf}')

        if v_before != '':
            print(f'  Verify: {v_before} → {v_after} (dropped: verifier={v_dropped_v}, evidence={v_dropped_e})')

        # Anomalies
        anom_flags = [k for k, v in anomalies.items() if v]
        if anom_flags:
            print(f'  ⚠ Anomalies: {anom_flags}')

        # Suggestions
        print(f'  Suggestions: {len(suggs)}')
        for s in suggs:
            sev = s.get('severity', '?')
            conf = s.get('confidence', '?')
            file = s.get('relevantFile', '?')
            file_short = file.split('/')[-1] if file else '?'
            lines = f\":{s.get('relevantLinesStart','')}-{s.get('relevantLinesEnd','')}\" if s.get('relevantLinesStart') else ''
            summary = s.get('oneSentenceSummary', '')[:100]
            content = s.get('suggestionContent', '')[:150]
            print(f'    [{sev}/{conf}] {file_short}{lines}')
            print(f'      {summary or content}')

        # Coverage details
        if show_coverage and cov_touched_files:
            print(f'  Coverage details:')
            for tf in cov_touched_files:
                short = tf.split('/')[-1] if '/' in tf else tf
                print(f'    ✅ {short}')
            for pf in cov_pending:
                short = pf.split('/')[-1] if '/' in pf else pf
                print(f'    ❌ {short}')

        # Reasoning
        if show_reasoning and reasoning:
            print(f'  Reasoning:')
            # Wrap at 120 chars
            text = reasoning[:1000] + ('...' if len(reasoning) > 1000 else '')
            for i in range(0, len(text), 120):
                print(f'    {text[i:i+120]}')

        # Tool calls
        if show_tools and tc:
            print(f'  Tool calls ({len(tc)}):')
            for i, t in enumerate(tc):
                tool = t.get('tool', t.get('toolName', '?'))
                args = t.get('args', {})
                result = str(t.get('result', ''))

                if tool == 'readFile':
                    path = args.get('path', args.get('filePath', '?'))
                    path_short = path.split('/')[-1] if '/' in str(path) else str(path)
                    start_l = args.get('startLine', '')
                    end_l = args.get('endLine', '')
                    range_str = f':{start_l}-{end_l}' if start_l else ' (full)'
                    result_lines = len(result.split(chr(10))) if result else 0
                    print(f'    #{i+1:>2} readFile {path_short}{range_str} → {result_lines} lines')

                elif tool == 'grep':
                    pattern = args.get('pattern', '?')
                    exclude = ' (excl tests)' if args.get('excludeTests') else ''
                    names_only = ' (names only)' if args.get('namesOnly') else ''
                    match_count = result.count(chr(10)) + 1 if result and 'No matches' not in result and 'Error' not in result else 0
                    status = f'{match_count} matches' if match_count > 0 else ('no matches' if 'No matches' in result else 'error')
                    # Show first file match
                    first_file = ''
                    if match_count > 0:
                        first_line = result.split(chr(10))[0]
                        if ':' in first_line:
                            first_file = f' → {first_line.split(\":\")[0].split(\"/\")[-1]}'
                    print(f'    #{i+1:>2} grep \"{pattern}\"{exclude}{names_only} → {status}{first_file}')

                elif tool == 'getCallers':
                    fn = args.get('functionName', '?')
                    has_data = 'No call graph' not in result if result else False
                    result_preview = result[:100].replace(chr(10), ' | ') if has_data else 'no data'
                    print(f'    #{i+1:>2} getCallers({fn}) → {result_preview}')

                elif tool == 'checkTypes':
                    path = args.get('path', '.')
                    has_errors = result and 'No type errors' not in result and result.strip()
                    status = 'found issues' if has_errors else 'clean'
                    print(f'    #{i+1:>2} checkTypes({path}) → {status}')
                    if has_errors and result:
                        for line in result.split(chr(10))[:3]:
                            if line.strip():
                                print(f'         {line.strip()[:100]}')

                elif tool == 'findFile':
                    pattern = args.get('pattern', '?')
                    count = len(result.split(chr(10))) if result and result.strip() else 0
                    print(f'    #{i+1:>2} findFile(\"{pattern}\") → {count} files')

                elif tool == 'listDir':
                    path = args.get('path', '.')
                    print(f'    #{i+1:>2} listDir({path})')

                else:
                    print(f'    #{i+1:>2} {tool}({json.dumps(args)[:80]})')

        # Verification decisions
        if show_verify and verification.get('decisions'):
            print(f'  Verify decisions:')
            for d in verification['decisions']:
                action = d.get('action', '?')
                file = (d.get('relevantFile', '?') or '?').split('/')[-1]
                rationale = d.get('rationale', '')[:200]
                conf = d.get('confidence', '?')
                parse = d.get('parseMode', '')
                icon = '✅' if action == 'keep' else '❌'

                # Show evidence
                evidence = d.get('verifierEvidence', {}) or {}
                strong = evidence.get('strongFiles', [])
                weak = evidence.get('weakFiles', [])
                ev_str = ''
                if strong:
                    ev_str = f' evidence:[{\";\".join(f.split(\"/\")[-1] for f in strong[:3])}]'

                print(f'    {icon} [{action}/{conf}] {file}{ev_str}')
                print(f'       {rationale}')

        print()

    if len(batches) > 1:
        print()

# Changed files
if agents:
    inputs = agents[0].get('inputs', {}) or {}
    changed_files = inputs.get('changedFiles', []) or []
    if changed_files:
        print(f'━━━ Changed Files ({len(changed_files)}) ━━━')
        for f in changed_files:
            fname = f.get('filename', '?')
            patch = f.get('patch', f.get('patchWithLinesStr', ''))
            patch_lines = len(patch.split(chr(10))) if patch else 0
            print(f'  {fname} ({patch_lines} diff lines)')
"
