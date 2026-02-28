import z from 'zod';

export interface CrossFileContextPlannerPayload {
    diffSummary: string;
    changedFilenames: string[];
    language: string;
}

export const CrossFileContextPlannerSchema = z.object({
    queries: z
        .array(
            z.object({
                pattern: z.string().min(1),
                rationale: z.string().min(1),
                riskLevel: z.enum(['low', 'medium', 'high']),
                symbolName: z.string().optional(),
                fileGlob: z.string().optional(),
                sourceFile: z.string().min(1),
            }),
        )
        .max(8),
});

export type CrossFileContextPlannerSchemaType = z.infer<
    typeof CrossFileContextPlannerSchema
>;

export const prompt_cross_file_context_planner = (
    payload: CrossFileContextPlannerPayload,
) => {
    return `You are a code analysis planner. Your task is to analyze a PR diff and generate targeted ripgrep (rg) search patterns to find call-sites, consumers, and dependents in files OUTSIDE the PR.

## Goal
Given the diff summary and changed filenames below, produce up to 8 search queries that will help find code in the repository that may be affected by these changes.

### Category 1: Consumers & Callers (standard)
- Functions/methods/classes that were modified, renamed, or had their signatures changed
- Exported interfaces/types that changed shape
- Constants or config keys that were renamed or removed
- API endpoints or routes that were modified

### Category 2: Symmetric / Counterpart Operations (CRITICAL — often missed)
Every data operation has a counterpart. If the diff touches ONE side, you MUST search for the OTHER side:
- **Create → Validate**: if code creates/stores a hash, token, key, or ID, search for the code that validates/verifies/looks up that same value
- **Encode → Decode**: if code serializes, encodes, or marshals data, search for the deserialization/decoding counterpart
- **Write → Read**: if code writes to a database, file, cache, or queue, search for the code that reads/consumes from the same source
- **Producer → Consumer**: if code emits events, publishes messages, or dispatches actions, search for listeners/subscribers/handlers
- **Format → Parse**: if code formats/stringifies output, search for the code that parses/interprets that format
- **Map keys**: if code builds a mapping (e.g., severity → label), search for code that reads from that same mapping using the old or new keys

### Category 3: Test ↔ Implementation Verification
- If a changed file is a **test/spec**, search for the **implementation** it tests (the module imported by the test) — the reviewer needs to see how the real code works to validate test assertions
- If a changed file is an **implementation**, search for its **test files** — to check if tests still match the new behavior

### Category 4: Configuration & Limits
- If the diff changes limits, thresholds, sizes, or defaults (e.g., max array size, timeout, retry count), search for where those limits are enforced or depended upon (e.g., server body-size config, rate limiters, pagination consumers)

## Input

### Changed Files
${JSON.stringify(payload.changedFilenames, null, 2)}

### Diff Summary
${payload.diffSummary}

## Instructions

1. Identify the most impactful symbols (functions, classes, types, constants) changed in the diff.
2. For each symbol, generate a regex pattern suitable for ripgrep that would find usages/call-sites of that symbol across the codebase.
3. **Apply the Symmetric Pair rule**: for every data operation in the diff (hash, encode, write, emit, format), generate at least one query to find the counterpart operation. Ask yourself: "this code CREATES X — where is X CONSUMED or VERIFIED?"
4. **Apply the Test↔Implementation rule**: if any changed file is a test, generate a query to find the implementation source. If any changed file is an implementation, generate a query for its tests.
5. Assign a riskLevel:
   - **high**: Signature changes, removed exports, renamed public APIs, symmetric pair mismatches (create vs validate), broken mappings
   - **medium**: Behavioral changes to widely-used functions, type narrowing, changed limits/thresholds
   - **low**: Internal refactors that might affect nearby consumers
6. Optionally provide a fileGlob to narrow the search (e.g., "*.ts" or "*.py").
7. Optionally provide the symbolName for the primary symbol being searched.

## Query Prioritization
Allocate your 8 queries wisely. Prioritize:
1. **Symmetric counterparts** — these are the #1 source of false positives when missed
2. **Direct consumers/callers** of changed signatures
3. **Test ↔ implementation** pairs
4. **Configuration dependents**

## Constraints
- Maximum 8 queries
- Patterns must be valid ripgrep regex
- Search for CONSUMERS, CALLERS, COUNTERPARTS, and VERIFIERS — not definitions
- Prefer precise patterns over broad ones to minimize noise
- Do NOT generate patterns that would only match inside the changed files themselves

## Output Format
Return a JSON object with a "queries" array. Each query has:
- pattern: ripgrep-compatible regex pattern
- rationale: why this search is important
- riskLevel: "low" | "medium" | "high"
- symbolName: (optional) the primary symbol name
- fileGlob: (optional) glob to filter files, e.g. "*.ts"
- sourceFile: the changed file where the symbol was modified (from the "Changed Files" list)

## Language
All rationale text must be in ${payload.language || 'en-US'}.
`;
};
