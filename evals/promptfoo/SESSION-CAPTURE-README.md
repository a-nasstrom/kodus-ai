# Session Capture Eval

End-to-end evaluation for the **session-capture classifier** — the LLM that extracts architectural decisions, conventions, tradeoffs, and other technical choices from CLI coding sessions.

Uses [promptfoo](https://promptfoo.dev) to run the same prompt used in production against multiple LLM providers and measure classification quality with deterministic assertions.

## Table of Contents

- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Adding a New Test Case](#adding-a-new-test-case)
  - [Step-by-Step Walkthrough](#step-by-step-walkthrough)
  - [Test Case Schema](#test-case-schema)
  - [Decision Types](#decision-types)
  - [Expected Decision Fields](#expected-decision-fields)
  - [Tuning Thresholds](#tuning-thresholds)
  - [Full Example](#full-example)
- [Adding a New Provider](#adding-a-new-provider)
- [Running the Eval](#running-the-eval)
- [Analyzing Results](#analyzing-results)
- [Metrics Explained](#metrics-explained)
  - [Score (0-1, continuous)](#score-0-1-continuous)
  - [Pass Rate (%, binary)](#pass-rate--binary)
- [Tips and Best Practices](#tips-and-best-practices)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# 1. Install promptfoo globally (if not already installed)
npm install -g promptfoo

# 2. Make sure your .env at the project root has the required API keys
#    API_GOOGLE_AI_API_KEY=...
#    API_CEREBRAS_API_KEY=...

# 3. Run the eval
./evals/promptfoo/run-session-capture-eval.sh

# 4. Analyze results
node evals/promptfoo/analyze-session-capture-results.js
```

---

## Project Structure

```
evals/promptfoo/
├── promptfoo-session-capture.yaml     # Main config: providers, prompt ref, dataset ref
├── session-capture-prompt.js          # Loads the SAME prompt from the backend source code
├── session-capture-assertion.js       # Deterministic scoring & pass/fail logic
├── analyze-session-capture-results.js # Post-run analysis script (by provider, by category)
├── run-session-capture-eval.sh        # Shell wrapper: loads .env keys, runs promptfoo
├── datasets/
│   └── session-capture-tests.json     # All test cases (the dataset)
└── results/
    └── session-capture-output.json    # Generated after a run
```

---

## How It Works

1. **Prompt**: `session-capture-prompt.js` extracts the **exact system prompt** from the backend source file (`libs/cli-review/application/use-cases/classify-cli-session-capture.use-case.ts`) at runtime. This ensures the eval always tests the real production prompt with no drift.

2. **Dataset**: Each test case in `datasets/session-capture-tests.json` simulates a CLI session with a summary, user prompt, assistant message, modified files, and tool uses.

3. **Providers**: The YAML config lists the LLM providers to test against (e.g., Cerebras, Google Gemini). Each test case is sent to every provider.

4. **Assertion**: `session-capture-assertion.js` parses the model output, matches predicted decisions against expected ones, and computes a score + pass/fail verdict.

5. **Analysis**: After a run, `analyze-session-capture-results.js` aggregates results by provider and by category.

---

## Adding a New Test Case

### Step-by-Step Walkthrough

Follow these steps to add a new test case from scratch:

#### 1. Open the dataset file

```
evals/promptfoo/datasets/session-capture-tests.json
```

This is a JSON array. You will append a new object to the end.

#### 2. Write the simulated session

Think of a realistic CLI coding session. You need five input fields that simulate what the classifier receives in production:

| Field | What it represents | Example |
|---|---|---|
| `summary` | A one-line summary of the session | `"Separated read and write paths"` |
| `prompt` | The user's original request to the AI | `"Improve scalability of the order system."` |
| `assistantMessage` | The AI's response describing what it did **and why** | `"I adopted a CQRS pattern, separating command handlers from query handlers..."` |
| `modifiedFiles` | JSON string of file paths that were changed | `"[\"src/orders/commands/handler.ts\"]"` |
| `toolUses` | JSON string of tool actions taken | `"[{\"tool\":\"Edit\",\"filePath\":\"src/orders/handler.ts\",\"summary\":\"Split handlers\"}]"` |

> **Important**: `modifiedFiles` and `toolUses` must be **JSON-encoded strings** (stringified arrays), not raw arrays. This is because promptfoo passes all vars as strings.

#### 3. Define expected decisions

Decide what decision(s) the classifier should extract from this session. For each expected decision, specify:

```jsonc
{
  "typeAnyOf": ["architectural_decision"],  // Acceptable type(s)
  "keywordsAll": ["cqrs"],                  // ALL must appear in output
  "keywordsAny": ["command", "query"]       // At least ONE must appear
}
```

Encode the array as a JSON string in `expectedDecisions`.

#### 4. Set thresholds

For most test cases, you can copy these defaults:

```json
"minDecisions": "1",
"maxDecisions": "3",
"minRecall": "1",
"minPrecision": "0.6",
"passThreshold": "0.72"
```

Adjust only if needed (see [Tuning Thresholds](#tuning-thresholds)).

#### 5. Add the assert block

Every test case must include this exact assertion block:

```json
"assert": [
  {
    "type": "javascript",
    "value": "file://session-capture-assertion.js"
  }
]
```

#### 6. Set a description with a category prefix

The `description` field uses `<category>: <label>` format. The analysis script groups results by the text before the colon.

```json
"description": "architecture: cqrs command/query separation"
```

#### 7. Validate and run

```bash
# Validate JSON syntax
node -e "JSON.parse(require('fs').readFileSync('evals/promptfoo/datasets/session-capture-tests.json','utf8'))"

# Run the eval
./evals/promptfoo/run-session-capture-eval.sh

# Check results
node evals/promptfoo/analyze-session-capture-results.js
```

---

### Test Case Schema

```jsonc
{
  // Category prefix is used for grouping in analysis output
  "description": "<category>: <short label>",

  "vars": {
    // --- Inputs (simulate the CLI session) ---
    "summary": "Short summary of the session",
    "prompt": "The user's original request",
    "assistantMessage": "The AI's response explaining what it did and why",
    "modifiedFiles": "[\"path/to/file.ts\"]",                          // JSON string
    "toolUses": "[{\"tool\":\"Edit\",\"filePath\":\"...\",\"summary\":\"...\"}]",  // JSON string

    // --- Expected output ---
    "expectedDecisions": "[{...}]",  // JSON string - array of expected decisions

    // --- Thresholds (optional, have sensible defaults) ---
    "minDecisions": "1",
    "maxDecisions": "3",
    "minRecall": "1",
    "minPrecision": "0.6",
    "passThreshold": "0.72"
  },

  "assert": [
    {
      "type": "javascript",
      "value": "file://session-capture-assertion.js"
    }
  ]
}
```

---

### Decision Types

The classifier outputs decisions with one of these types:

| Type | When to use |
|---|---|
| `architectural_decision` | Structural choices: module boundaries, patterns (CQRS, outbox), layering |
| `convention` | Team/project standards: naming, commit format, folder structure |
| `tradeoff` | Explicit trade-off acknowledged between competing concerns |
| `implementation_detail` | Specific technical implementation choice (algorithm, config, ordering) |
| `tooling` | Tool/framework adoption or change (bundler, test runner, package manager) |
| `other` | Anything that doesn't fit the above (rollout strategy, process decisions) |

---

### Expected Decision Fields

Each entry in `expectedDecisions` describes one decision you expect the model to extract:

```jsonc
{
  // Required: acceptable type(s) for this decision.
  // Use multiple values when the classification could reasonably go either way.
  "typeAnyOf": ["architectural_decision", "tradeoff"],

  // Optional: ALL of these keywords must appear in the decision text.
  // Searched in the combined text of: decision + rationale + evidence (case-insensitive).
  "keywordsAll": ["queue", "worker"],

  // Optional: at least ONE of these keywords must appear.
  "keywordsAny": ["throughput", "lock contention", "eventual"],

  // Optional: minimum confidence value the model should assign (0-1).
  "minConfidence": 0.7
}
```

**Matching rules:**
- `typeAnyOf` — The predicted decision's `type` must be in this list.
- `keywordsAll` — Every keyword must appear somewhere in the combined text. Keep these to the most distinctive 1-3 terms.
- `keywordsAny` — At least one keyword must appear. Use this for alternative phrasings (e.g., `"trade-off"`, `"tradeoff"`, `"compromise"`).
- `minConfidence` — If set, the predicted confidence must meet or exceed this value.

---

### Tuning Thresholds

| Parameter | Default | Description |
|---|---|---|
| `minDecisions` | same as `expectedDecisions.length` | Minimum decisions the model should output |
| `maxDecisions` | `max(minDecisions, expected + 2)` | Max before count penalty kicks in |
| `passThreshold` | `0.72` (or `1.0` if 0 expected) | Minimum composite score to pass |
| `minRecall` | `1.0` | Fraction of expected decisions that must be strictly matched |
| `minPrecision` | `0.6` | Fraction of predicted decisions that must be correct |

**Guidelines:**
- **Clear, unambiguous decisions** — use strict defaults (`minRecall: 1`, `minPrecision: 0.6`)
- **Multiple valid interpretations** — lower `minPrecision` to `0.33`-`0.5`
- **Multi-decision tests** — consider lowering `minRecall` (e.g., `0.66` for 3 expected decisions)
- **"Empty" tests** (no decisions expected) — set `minDecisions: 0`, `maxDecisions: 0`, `passThreshold: 1`

---

### Full Example

A complete test case for a CQRS architecture decision:

```json
{
  "description": "architecture: cqrs command/query separation",
  "vars": {
    "summary": "Separated read and write paths",
    "prompt": "Improve scalability of the order system.",
    "assistantMessage": "I adopted a CQRS pattern, separating command handlers from query handlers. Commands mutate state through aggregates while queries read from denormalized views.",
    "modifiedFiles": "[\"src/orders/commands/create-order.handler.ts\",\"src/orders/queries/get-order.handler.ts\"]",
    "toolUses": "[{\"tool\":\"Write\",\"filePath\":\"src/orders/commands/create-order.handler.ts\",\"summary\":\"Added command handler\"},{\"tool\":\"Write\",\"filePath\":\"src/orders/queries/get-order.handler.ts\",\"summary\":\"Added query handler\"}]",
    "expectedDecisions": "[{\"typeAnyOf\":[\"architectural_decision\"],\"keywordsAll\":[\"cqrs\"],\"keywordsAny\":[\"command\",\"query\",\"separation\"]}]",
    "minDecisions": "1",
    "maxDecisions": "3",
    "minRecall": "1",
    "minPrecision": "0.6",
    "passThreshold": "0.72"
  },
  "assert": [
    {
      "type": "javascript",
      "value": "file://session-capture-assertion.js"
    }
  ]
}
```

An "empty" test case (session with no extractable decisions):

```json
{
  "description": "empty: generic bug fix with no design choice",
  "vars": {
    "summary": "Fixed null pointer",
    "prompt": "Fix the crash on login.",
    "assistantMessage": "Fixed the null check that was missing in the login handler.",
    "modifiedFiles": "[\"src/auth/login.ts\"]",
    "toolUses": "[{\"tool\":\"Edit\",\"filePath\":\"src/auth/login.ts\",\"summary\":\"Added null check\"}]",
    "expectedDecisions": "[]",
    "minDecisions": "0",
    "maxDecisions": "0",
    "minRecall": "1",
    "minPrecision": "1",
    "passThreshold": "1"
  },
  "assert": [
    {
      "type": "javascript",
      "value": "file://session-capture-assertion.js"
    }
  ]
}
```

---

### Description Categories

The `description` prefix (text before `:`) is used to group results in the analysis output. Current categories in the dataset:

| Category | What it covers |
|---|---|
| `architecture` | Structural/design decisions |
| `convention` | Naming, formatting, team standards |
| `tradeoff` | Explicit trade-off analysis |
| `implementation detail` | Specific technical choices |
| `tooling` | Tool/framework adoption |
| `other` | Process, rollout, non-technical decisions |
| `empty` | Sessions with no extractable decisions |
| `multi` | Sessions containing multiple decision types |

You can use any category string — the analysis script picks it up automatically.

---

## Adding a New Provider

Edit `promptfoo-session-capture.yaml`:

```yaml
providers:
  - id: cerebras:zai-glm-4.7
    config:
      temperature: 0
      max_tokens: 4096

  - id: google:gemini-3-flash-preview
    config:
      temperature: 0
      maxOutputTokens: 4096

  # Add your new provider:
  - id: openai:gpt-4o
    config:
      temperature: 0
      max_tokens: 4096
```

Then update `run-session-capture-eval.sh` to export the required API key:

```bash
export OPENAI_API_KEY="$(extract_env API_OPEN_AI_API_KEY)"
```

And add the key to your root `.env`:

```
API_OPEN_AI_API_KEY=sk-...
```

See the [promptfoo providers docs](https://promptfoo.dev/docs/providers) for all supported provider IDs.

---

## Running the Eval

### Using the shell script (recommended)

```bash
./evals/promptfoo/run-session-capture-eval.sh
```

This script:
1. Reads API keys from the project root `.env`
2. Maps them to the env vars promptfoo expects
3. Runs `promptfoo eval` with concurrency of 6

Pass extra flags through:

```bash
# Filter by description
./evals/promptfoo/run-session-capture-eval.sh --filter-description "architecture"

# Lower concurrency
./evals/promptfoo/run-session-capture-eval.sh -j 2

# Skip cache
./evals/promptfoo/run-session-capture-eval.sh --no-cache
```

### Manual run

```bash
cd evals/promptfoo
export GOOGLE_API_KEY="your-key"
export CEREBRAS_API_KEY="your-key"
promptfoo eval -c promptfoo-session-capture.yaml -j 6
```

### View results in the promptfoo UI

```bash
promptfoo view
```

Opens a local web UI where you can inspect each test case, see raw model outputs, scores, and pass/fail status. Very useful for debugging failures.

---

## Analyzing Results

After running the eval, results are saved to `results/session-capture-output.json`.

```bash
node evals/promptfoo/analyze-session-capture-results.js
```

Or with a custom results path:

```bash
node evals/promptfoo/analyze-session-capture-results.js path/to/output.json
```

### Sample output

```
Session Capture Eval Analysis
Eval ID: abc123
Rows: 52

By Provider
-----------
cerebras:zai-glm-4.7          | pass 22/26 (84.6%) | fail 4 | error 0 | avgScore 0.891 | avgRecall 0.923 | avgPrecision 0.856 | avgSoft 0.912 | avgCount 0.981 | avgLatency 1.23s
google:gemini-3-flash-preview  | pass 20/26 (76.9%) | fail 5 | error 1 | avgScore 0.845 | avgRecall 0.885 | avgPrecision 0.812 | avgSoft 0.878 | avgCount 0.962 | avgLatency 2.45s

By Category
-----------
architecture          | pass 8/8 (100.0%) | ...
convention            | pass 6/8 (75.0%)  | ...
empty                 | pass 4/4 (100.0%) | ...
implementation detail | pass 7/8 (87.5%)  | ...
```

---

## Metrics Explained

### Score (0-1, continuous)

A weighted quality measure of how well the model performed:

| Component | Weight | What it measures |
|---|---|---|
| **Recall** | 45% | Fraction of expected decisions that were strictly matched |
| **Soft Coverage** | 25% | Softer matching — partial keyword/type matches still contribute |
| **Precision** | 20% | Of all predicted decisions, fraction that are strictly correct |
| **Count Score** | 10% | Penalty if decision count is outside the acceptable min/max range |

### Pass Rate (%, binary)

A test **passes** only when **all four** conditions are met simultaneously:

| Condition | Default threshold |
|---|---|
| `score >= passThreshold` | 0.72 |
| `recall >= minRecall` | 1.0 |
| `precision >= minPrecision` | 0.6 |
| `countScore >= 0.7` | 0.7 (hard-coded) |

**Key insight**: A test can have a high score (e.g., 0.85) but still **fail** if any single condition is not met. For example, if `recall < 1.0` because the model missed one expected decision, the test fails regardless of the overall score.

### Per-Decision Pair Scoring

When matching a predicted decision to an expected one, the pair score is:

| Component | Weight | Condition for full score |
|---|---|---|
| Type match | 50% | Predicted `type` is in `typeAnyOf` |
| Keywords (all) | 25% | All `keywordsAll` found in decision text |
| Keywords (any) | 15% | At least one `keywordsAny` found |
| Confidence | 10% | Confidence meets `minConfidence` threshold |

A pair is a **strict match** only when all four components score 1.0.

---

## Tips and Best Practices

1. **Start with the assistant message.** Write a realistic `assistantMessage` that clearly states the decision and reasoning. If a human can't identify the decision from the message, the model won't either.

2. **Use `typeAnyOf` generously.** Many decisions can legitimately be classified as multiple types. A caching choice could be a `tradeoff` or `implementation_detail`. Accept all reasonable types.

3. **Pick distinctive keywords.** For `keywordsAll`, choose 1-3 words that uniquely identify the decision. Avoid generic terms like "decided" or "implemented".

4. **Use `keywordsAny` for alternative phrasing.** If the model might say "trade-off" or "tradeoff" or "compromise", list all variants.

5. **Test "empty" cases too.** Sessions where the assistant gives a generic status update with no real design choice should produce zero decisions.

6. **Use `promptfoo view` for debugging.** When a test fails, the UI lets you see the raw model output and understand exactly what went wrong.

7. **Keep `temperature: 0`.** The eval config uses deterministic outputs. Don't change this unless you're intentionally testing variance.

8. **Validate JSON before running.** A single syntax error in the dataset file will cause all tests to fail:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('evals/promptfoo/datasets/session-capture-tests.json','utf8'))"
   ```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `promptfoo: command not found` | Run `npm install -g promptfoo` |
| API key errors | Check `.env` at project root has `API_GOOGLE_AI_API_KEY` and `API_CEREBRAS_API_KEY` |
| `Could not extract backend session-capture prompt block` | The prompt format in `classify-cli-session-capture.use-case.ts` changed — update the regex in `session-capture-prompt.js` |
| All tests fail with `parse_fail=true` | The model is not returning valid JSON with a `decisions` array — check raw output in `promptfoo view` |
| Score is high but test still fails | Check which threshold was not met — usually `recall < 1.0` (missed a decision) or `countScore < 0.7` (too many/few decisions) |
| Analysis shows `uncategorized` | The test `description` is missing the `<category>: <label>` format |
| JSON parse error on dataset | Run the validation command above to find the syntax error |
