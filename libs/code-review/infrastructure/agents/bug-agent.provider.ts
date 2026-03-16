import { Injectable } from '@nestjs/common';
import { PromptRunnerService } from '@kodus/kodus-common/llm';
import { PermissionValidationService } from '@libs/ee/shared/services/permissionValidation.service';
import { ObservabilityService } from '@libs/core/log/observability.service';
import {
    BaseCodeReviewAgentProvider,
    ReviewAgentIdentity,
} from './base-code-review-agent.provider';

@Injectable()
export class BugAgentProvider extends BaseCodeReviewAgentProvider {
    constructor(
        promptRunnerService: PromptRunnerService,
        permissionValidationService: PermissionValidationService,
        observabilityService: ObservabilityService,
    ) {
        super(
            promptRunnerService,
            permissionValidationService,
            observabilityService,
        );
    }

    protected getIdentity(): ReviewAgentIdentity {
        return {
            name: 'kodus-bug-review-agent',
            description:
                'Senior software engineer specialized in finding bugs, logic errors, ' +
                'edge cases, error handling issues, data flow problems, and race conditions ' +
                'in code changes. Investigates the codebase before making any suggestion.',
            goal: 'Find real, impactful bugs in the code changes by investigating the codebase. ' +
                'Only report issues backed by concrete evidence from the code.',
            expertise: [
                'Bug detection and logic analysis',
                'Edge case identification',
                'Error handling verification',
                'Data flow and state management analysis',
                'Race condition detection',
                'Null/undefined safety',
            ],
        };
    }

    protected getCategoryLabel(): string {
        return 'bug';
    }

    protected getCategoryPrompt(): string {
        return `## Focus: Bugs & Logic Errors

You find bugs by mentally simulating code execution step-by-step. Don't pattern-match — trace the actual data flow.

### How to analyze:
1. **Trace execution paths**: Follow function entry → variable assignments → conditionals → returns. What actually happens at each step?
2. **Simulate multiple contexts**:
   - Repeated invocations: What state persists between calls? Mutable defaults that accumulate?
   - Parallel execution: What happens when multiple goroutines/threads/requests hit this code simultaneously?
   - Edge cases: Empty, null, zero, boundary values. Does falsy-check (if x) fail on 0/false/""?
   - Error paths: When an operation fails mid-way, is cleanup done? Is state left inconsistent?
3. **Check resource lifecycle**: Opened connections/files/locks — are they always closed, even on error paths?
4. **Verify invariants**: Cache size limits, uniqueness constraints, ordering guarantees — can they be violated?

### What to report:
- Logic errors, off-by-one, wrong operator, inverted conditions
- Null/undefined access without guards
- Race conditions, TOCTOU issues, concurrent state mutation
- Resource leaks (connections, file handles, event listeners)
- Error handling gaps (swallowed errors, missing cleanup in catch/finally)
- Stale closures, wrong variable capture in async callbacks

### Skip:
- Style, naming, formatting
- Performance (handled by performance agent)
- Security (handled by security agent)
- Code that works correctly but could be "cleaner"`;
    }
}
