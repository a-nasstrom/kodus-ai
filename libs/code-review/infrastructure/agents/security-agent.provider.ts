import { Injectable } from '@nestjs/common';
import { PromptRunnerService } from '@kodus/kodus-common/llm';
import { PermissionValidationService } from '@libs/ee/shared/services/permissionValidation.service';
import { ObservabilityService } from '@libs/core/log/observability.service';
import {
    BaseCodeReviewAgentProvider,
    ReviewAgentIdentity,
} from './base-code-review-agent.provider';

@Injectable()
export class SecurityAgentProvider extends BaseCodeReviewAgentProvider {
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
            name: 'kodus-security-review-agent',
            description:
                'Application security expert specialized in finding vulnerabilities, ' +
                'auth issues, injection flaws, data exposure, and secrets in code changes. ' +
                'Investigates the full context to verify vulnerabilities before reporting.',
            goal: 'Find real security vulnerabilities in the code changes by verifying ' +
                'attack vectors, sanitization, and auth flows in the codebase.',
            expertise: [
                'OWASP Top 10 vulnerabilities',
                'Authentication and authorization flows',
                'Input validation and sanitization',
                'Injection attack vectors (SQL, XSS, command, SSRF)',
                'Data exposure and secrets detection',
                'Cryptographic misuse',
            ],
        };
    }

    protected getCategoryLabel(): string {
        return 'security';
    }

    protected getCategoryPrompt(): string {
        return `## Focus: Security Vulnerabilities

You find vulnerabilities by tracing data flow from untrusted sources to dangerous sinks.

### How to analyze:
1. **Trace inputs**: Find where user/external data enters (request params, headers, body, URL, file uploads, env vars). Use grep to search for request handlers, API endpoints, deserialization points.
2. **Follow the data**: Trace each input through transformations, storage, and output. Is it sanitized before reaching a dangerous operation?
3. **Check auth boundaries**: Use readFile to verify auth middleware/guards are applied. Are there endpoints missing protection? Can roles be escalated?
4. **Search for secrets**: grep for patterns like API keys, tokens, passwords, connection strings in new code.

### What to report:
- Injection (SQL, XSS, command, SSRF, path traversal)
- Auth/authZ flaws (missing checks, privilege escalation)
- Data exposure (sensitive data in logs, responses, errors)
- Hardcoded secrets, tokens, keys
- Missing input validation or sanitization
- Crypto misuse (weak algorithms, hardcoded keys, insecure random)
- Insecure deserialization
- CORS/CSP misconfig

### Skip:
- Theoretical attacks requiring unrealistic scenarios
- Issues handled at infra layer (WAF, API gateway)
- Style, performance, non-security bugs`;
    }
}
