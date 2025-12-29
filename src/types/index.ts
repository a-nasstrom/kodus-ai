export type Severity = 'info' | 'warning' | 'error';
export type OutputFormat = 'terminal' | 'json' | 'markdown';

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
}

export interface ReviewIssue {
  file: string;
  line: number;
  endLine?: number;
  severity: Severity;
  message: string;
  suggestion?: string;
  ruleId?: string;
}

export interface ReviewResult {
  summary: string;
  issues: ReviewIssue[];
  filesAnalyzed: number;
  duration: number;
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

export interface GlobalOptions {
  format: OutputFormat;
  output?: string;
  verbose: boolean;
  quiet: boolean;
  org?: string;
  repo?: string;
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

