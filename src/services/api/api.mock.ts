import type {
  AuthResponse,
  RemoteConfig,
  ReviewConfig,
  ReviewResult,
  PullRequestSuggestionsResponse,
  TrialReviewResult,
  TrialStatus,
} from '../../types/index.js';
import { ApiError } from '../../types/index.js';
import type { IKodusApi, IAuthApi, IReviewApi, IConfigApi, ITrialApi, GitMetrics } from './api.interface.js';

const MOCK_DELAY = 800;

const trialUsage = new Map<string, { count: number; resetAt: number }>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateMockToken(): string {
  return 'mock_' + Math.random().toString(36).substring(2) + '_' + Date.now();
}

const mockIssues = [
  {
    file: 'src/index.ts',
    line: 15,
    severity: 'warning' as const,
    category: 'style' as const,
    message: 'Consider using const instead of let for variables that are never reassigned',
    suggestion: 'const value = getData();',
    ruleId: 'prefer-const',
  },
  {
    file: 'src/utils.ts',
    line: 42,
    severity: 'error' as const,
    category: 'bug' as const,
    message: 'Potential null reference. Add null check before accessing property',
    suggestion: 'if (user?.name) { ... }',
    ruleId: 'null-safety',
  },
  {
    file: 'src/api.ts',
    line: 88,
    severity: 'info' as const,
    category: 'best_practices' as const,
    message: 'Consider adding error handling for this async operation',
    suggestion: 'try { await fetch(...) } catch (e) { handleError(e) }',
    ruleId: 'async-error-handling',
  },
  {
    file: 'src/components/Button.tsx',
    line: 23,
    severity: 'warning' as const,
    category: 'performance' as const,
    message: 'Missing dependency in useEffect hook',
    suggestion: 'useEffect(() => { ... }, [dependency])',
    ruleId: 'react-hooks/exhaustive-deps',
  },
  {
    file: 'src/services/auth.ts',
    line: 56,
    severity: 'error' as const,
    category: 'security_vulnerability' as const,
    message: 'Sensitive data should not be logged',
    suggestion: 'Remove console.log containing user credentials',
    ruleId: 'security/no-sensitive-logs',
  },
];

class MockAuthApi implements IAuthApi {
  async login(email: string, password: string): Promise<AuthResponse> {
    await delay(MOCK_DELAY);

    if (password.length < 6) {
      throw new ApiError(401, 'Invalid credentials');
    }

    return {
      accessToken: generateMockToken(),
      refreshToken: generateMockToken(),
      expiresIn: 3600,
      user: {
        id: 'user_' + Math.random().toString(36).substring(2),
        email,
        orgs: ['kodus', 'my-org'],
      },
    };
  }

  async signup(email: string, password: string): Promise<AuthResponse> {
    await delay(MOCK_DELAY);

    if (password.length < 6) {
      throw new ApiError(400, 'Password must be at least 6 characters');
    }

    if (email === 'existing@example.com') {
      throw new ApiError(409, 'Email already registered');
    }

    return {
      accessToken: generateMockToken(),
      refreshToken: generateMockToken(),
      expiresIn: 3600,
      user: {
        id: 'user_' + Math.random().toString(36).substring(2),
        email,
        orgs: [],
      },
    };
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    await delay(MOCK_DELAY / 2);

    if (!refreshToken || !refreshToken.startsWith('mock_')) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    return {
      accessToken: generateMockToken(),
      refreshToken: generateMockToken(),
      expiresIn: 3600,
      user: {
        id: 'user_mock',
        email: 'user@example.com',
        orgs: ['kodus'],
      },
    };
  }

  async logout(_accessToken: string): Promise<void> {
    await delay(MOCK_DELAY / 2);
  }

  async generateCIToken(_accessToken: string): Promise<string> {
    await delay(MOCK_DELAY);
    return 'kodus_ci_' + generateMockToken();
  }

  async verify(accessToken: string): Promise<{ valid: boolean; user?: any }> {
    await delay(MOCK_DELAY / 2);
    
    if (!accessToken || !accessToken.startsWith('mock_')) {
      return { valid: false };
    }

    return {
      valid: true,
      user: {
        id: 'user_mock',
        email: 'test@kodus.io',
        orgs: ['kodus', 'my-org'],
      },
    };
  }
}

class MockReviewApi implements IReviewApi {
  async analyze(diff: string, _accessToken: string, _config?: ReviewConfig): Promise<ReviewResult> {
    await delay(MOCK_DELAY * 3);

    const fileCount = (diff.match(/diff --git/g) || []).length || 1;
    const issueCount = Math.min(Math.floor(Math.random() * 4) + 1, mockIssues.length);
    const selectedIssues = mockIssues.slice(0, issueCount);

    return {
      summary: `Found ${issueCount} issue${issueCount > 1 ? 's' : ''} in ${fileCount} file${fileCount > 1 ? 's' : ''}`,
      issues: selectedIssues,
      filesAnalyzed: fileCount,
      duration: Math.floor(Math.random() * 2000) + 1000,
    };
  }

  async analyzeWithMetrics(
    diff: string,
    accessToken: string,
    config?: ReviewConfig,
    _metrics?: GitMetrics
  ): Promise<ReviewResult> {
    if (_metrics) {
      console.warn('Mocked analyzeWithMetrics call ignores provided metrics.');
    }
    return this.analyze(diff, accessToken, config);
  }

  async getPullRequestSuggestions(
    _accessToken: string,
    params: { prUrl?: string; prNumber?: number; repositoryId?: string; format?: 'markdown'; severity?: string; category?: string }
  ): Promise<PullRequestSuggestionsResponse> {
    await delay(MOCK_DELAY);

    if (!params.prUrl && !(params.prNumber && params.repositoryId)) {
      throw new ApiError(400, 'prUrl or prNumber + repositoryId are required');
    }

    const filterList = (value?: string): string[] | undefined => {
      if (!value) return undefined;
      return value.split(',').map((v) => v.trim()).filter(Boolean);
    };

    const severityFilters = filterList(params.severity);
    const categoryFilters = filterList(params.category);

    const filtered = mockIssues.filter((issue) => {
      const matchesSeverity = !severityFilters || severityFilters.includes(issue.severity);
      const matchesCategory = !categoryFilters || (issue.category && categoryFilters.includes(issue.category));
      return matchesSeverity && matchesCategory;
    });

    const suggestions = filtered.length > 0 ? filtered : mockIssues;

    const markdown = params.format === 'markdown'
      ? ['# Mocked pull request suggestions', ...suggestions.map((s) => `- (${s.severity}) ${s.file}:${s.line} ${s.message}`)].join('\n')
      : undefined;

    return {
      summary: 'Mocked pull request suggestions',
      suggestions,
      filesAnalyzed: 1,
      duration: MOCK_DELAY,
      markdown,
      deliveryStatus: 'sent',
    };
  }

  async trialAnalyze(diff: string, fingerprint: string): Promise<TrialReviewResult> {
    await delay(MOCK_DELAY * 3);

    const now = Date.now();
    const resetTime = new Date();
    resetTime.setHours(24, 0, 0, 0);

    let usage = trialUsage.get(fingerprint);
    
    if (!usage || usage.resetAt < now) {
      usage = { count: 0, resetAt: resetTime.getTime() };
    }

    usage.count++;
    trialUsage.set(fingerprint, usage);

    const fileCount = (diff.match(/diff --git/g) || []).length || 1;
    const issueCount = Math.min(Math.floor(Math.random() * 3) + 1, 3);
    const selectedIssues = mockIssues.slice(0, issueCount);

    return {
      summary: `Found ${issueCount} issue${issueCount > 1 ? 's' : ''} in ${fileCount} file${fileCount > 1 ? 's' : ''}`,
      issues: selectedIssues,
      filesAnalyzed: fileCount,
      duration: Math.floor(Math.random() * 2000) + 1000,
      trialInfo: {
        reviewsUsed: usage.count,
        reviewsLimit: 5,
        resetsAt: new Date(usage.resetAt).toISOString(),
      },
    };
  }
}

class MockConfigApi implements IConfigApi {
  async get(_accessToken: string, org?: string, _repo?: string): Promise<RemoteConfig> {
    await delay(MOCK_DELAY / 2);

    return {
      language: 'en',
      severity: 'warning',
      rules: {
        security: true,
        performance: true,
        style: true,
        bestPractices: true,
      },
      ignore: ['node_modules/**', 'dist/**', '*.test.ts', '*.spec.ts'],
      llmProvider: org === 'enterprise' ? 'byok' : 'kodus',
    };
  }
}

class MockTrialApi implements ITrialApi {
  async getStatus(fingerprint: string): Promise<TrialStatus> {
    await delay(MOCK_DELAY / 2);

    const now = Date.now();
    const resetTime = new Date();
    resetTime.setHours(24, 0, 0, 0);

    const usage = trialUsage.get(fingerprint);
    const count = usage && usage.resetAt > now ? usage.count : 0;

    return {
      fingerprint,
      reviewsUsed: count,
      reviewsLimit: 5,
      filesLimit: 10,
      linesLimit: 500,
      resetsAt: resetTime.toISOString(),
      isLimited: count >= 5,
    };
  }
}

export class MockApi implements IKodusApi {
  auth: IAuthApi = new MockAuthApi();
  review: IReviewApi = new MockReviewApi();
  config: IConfigApi = new MockConfigApi();
  trial: ITrialApi = new MockTrialApi();
}

