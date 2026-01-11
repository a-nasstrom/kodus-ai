export type Severity = 'info' | 'warning' | 'error' | 'critical';
export type OutputFormat = 'terminal' | 'json' | 'markdown' | 'prompt';
export type IssueCategory =
  | 'security_vulnerability'
  | 'performance'
  | 'code_quality'
  | 'best_practices'
  | 'style'
  | 'bug'
  | 'complexity'
  | 'maintainability';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserInfo;
}

export interface UserInfo {
  id: string;
  email: string;
  orgs: string[];
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: UserInfo;
}

export interface ReviewConfig {
  org?: string;
  repo?: string;
  severity?: Severity;
  rules?: {
    security?: boolean;
    performance?: boolean;
    style?: boolean;
    bestPractices?: boolean;
  };
  rulesOnly?: boolean;
  fast?: boolean;
  files?: FileContent[];
}

export interface CodeFix {
  type: 'replace' | 'insert' | 'delete';
  startLine: number;
  endLine: number;
  oldCode: string;
  newCode: string;
}

export interface ReviewIssue {
  file: string;
  line: number;
  endLine?: number;
  severity: Severity;
  category?: IssueCategory;
  message: string;
  suggestion?: string;
  recommendation?: string;
  ruleId?: string;
  fixable?: boolean;
  fix?: CodeFix;
}

export interface ReviewResult {
  summary: string;
  issues: ReviewIssue[];
  filesAnalyzed: number;
  duration: number;
}

export interface PullRequestSuggestionsResponse {
  summary?: string;
  issues?: ReviewIssue[];
  suggestions?: ReviewIssue[];
  filesAnalyzed?: number;
  duration?: number;
  markdown?: string;
  deliveryStatus?: string;
}

export interface TrialReviewResult extends ReviewResult {
  trialInfo: {
    reviewsUsed: number;
    reviewsLimit: number;
    resetsAt: string;
  };
}

export interface RemoteConfig {
  language: string;
  severity: Severity;
  rules: {
    security: boolean;
    performance: boolean;
    style: boolean;
    bestPractices: boolean;
  };
  ignore: string[];
  llmProvider: 'kodus' | 'byok';
}

export interface TrialStatus {
  fingerprint: string;
  reviewsUsed: number;
  reviewsLimit: number;
  filesLimit: number;
  linesLimit: number;
  resetsAt: string;
  isLimited: boolean;
}

export interface FileDiff {
  file: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diff: string;
}

export interface FileContent {
  path: string;
  content: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  diff: string;
}

export interface ProjectContext {
  cursorRules?: string;
  claudeRules?: string;
  kodusRules?: string;
  customContext?: string;
}

export interface GlobalOptions {
  format: OutputFormat;
  output?: string;
  verbose: boolean;
  quiet: boolean;
  org?: string;
  repo?: string;
  interactive?: boolean;
  promptOnly?: boolean;
  fix?: boolean;
  context?: string;
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface GitInfo {
  userEmail?: string;
  remote?: string | null;
  branch?: string;
  commitSha?: string;
}

export type PlatformType = 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'AZURE_REPOS' | undefined;

