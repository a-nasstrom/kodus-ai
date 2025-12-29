import type {
  AuthResponse,
  RemoteConfig,
  ReviewConfig,
  ReviewResult,
  TrialReviewResult,
  TrialStatus,
} from '../../types/index.js';
import { ApiError } from '../../types/index.js';
import type { IKodusApi, IAuthApi, IReviewApi, IConfigApi, ITrialApi } from './api.interface.js';

const API_BASE_URL = process.env.KODUS_API_URL || 'https://api.kodus.io';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Request failed' })) as { message?: string };
    throw new ApiError(response.status, errorData.message || 'Request failed');
  }

  return response.json() as Promise<T>;
}

class RealAuthApi implements IAuthApi {
  async login(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async signup(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  async logout(accessToken: string): Promise<void> {
    await request<void>('/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  async generateCIToken(accessToken: string): Promise<string> {
    const response = await request<{ token: string }>('/auth/ci-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.token;
  }

  async verify(accessToken: string): Promise<{ valid: boolean; user?: any }> {
    try {
      const response = await request<{ id: string; email: string; orgs: string[] }>('/auth/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return {
        valid: true,
        user: response,
      };
    } catch (error) {
      if (process.env.KODUS_VERBOSE) {
        console.error('Token verification failed:', error);
      }
      return { valid: false };
    }
  }
}

class RealReviewApi implements IReviewApi {
  async analyze(diff: string, accessToken: string, config?: ReviewConfig): Promise<ReviewResult> {
    return request<ReviewResult>('/cli/review', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ diff, config }),
    });
  }

  async trialAnalyze(diff: string, fingerprint: string): Promise<TrialReviewResult> {
    return request<TrialReviewResult>('/cli/trial/review', {
      method: 'POST',
      body: JSON.stringify({ diff, fingerprint }),
    });
  }
}

class RealConfigApi implements IConfigApi {
  async get(accessToken: string, org?: string, repo?: string): Promise<RemoteConfig> {
    const params = new URLSearchParams();
    if (org) params.set('org', org);
    if (repo) params.set('repo', repo);
    
    const query = params.toString() ? `?${params.toString()}` : '';
    
    return request<RemoteConfig>(`/cli/config${query}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }
}

class RealTrialApi implements ITrialApi {
  async getStatus(fingerprint: string): Promise<TrialStatus> {
    return request<TrialStatus>(`/cli/trial/status?fingerprint=${fingerprint}`);
  }
}

export class RealApi implements IKodusApi {
  auth: IAuthApi = new RealAuthApi();
  review: IReviewApi = new RealReviewApi();
  config: IConfigApi = new RealConfigApi();
  trial: ITrialApi = new RealTrialApi();
}

