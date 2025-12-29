import { api } from './api/index.js';
import { authService } from './auth.service.js';
import { gitService } from './git.service.js';
import { getTrialIdentifier } from '../utils/rate-limit.js';
import type { RemoteConfig, ReviewConfig, ReviewResult, TrialReviewResult } from '../types/index.js';

class ReviewService {
  async getConfig(org?: string, repo?: string): Promise<RemoteConfig> {
    const token = await authService.getValidToken();
    
    let effectiveOrg = org;
    let effectiveRepo = repo;

    if (!effectiveOrg || !effectiveRepo) {
      const detected = await gitService.extractOrgRepo();
      if (detected) {
        effectiveOrg = effectiveOrg || detected.org;
        effectiveRepo = effectiveRepo || detected.repo;
      }
    }

    return api.config.get(token, effectiveOrg, effectiveRepo);
  }

  async analyze(diff: string, config?: RemoteConfig, rulesOnly?: boolean, fast?: boolean): Promise<ReviewResult> {
    const token = await authService.getValidToken();
    
    const reviewConfig: ReviewConfig | undefined = config
      ? {
          severity: config.severity,
          rules: config.rules,
          rulesOnly,
          fast,
        }
      : undefined;

    return api.review.analyze(diff, token, reviewConfig);
  }

  async trialAnalyze(diff: string): Promise<TrialReviewResult> {
    const fingerprint = await getTrialIdentifier();
    return api.review.trialAnalyze(diff, fingerprint);
  }
}

export const reviewService = new ReviewService();

