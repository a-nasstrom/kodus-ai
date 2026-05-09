import type { TrialReviewResult, ReviewResult } from '../../types/review.js';

export function shouldUseInteractiveReview(params: {
    isAgent: boolean;
    interactive?: boolean;
    output?: string;
    format?: string;
}): boolean {
    return (
        (!params.isAgent && params.interactive === true) ||
        (!params.isAgent && !params.output && params.format === 'terminal')
    );
}

/**
 * Whether `kodus review` should hand the result off to the hunk TUI viewer
 * instead of the legacy inquirer menu / flat formatter. We only auto-promote
 * when every signal points to "interactive human": real TTY, no agent envelope,
 * no file output, default terminal format, and the review scope maps cleanly
 * onto something hunk can render (working tree or staged index).
 *
 * `--no-hunk` is the explicit escape hatch; `--interactive` keeps the legacy
 * navigation+fix UI for users who rely on it.
 */
export function shouldUseHunkViewer(params: {
    isAgent: boolean;
    interactive?: boolean;
    noHunk?: boolean;
    output?: string;
    format?: string;
    ttyOut: boolean;
    scopeSupported: boolean;
}): boolean {
    if (params.isAgent) {return false;}
    if (params.noHunk) {return false;}
    if (params.interactive === true) {return false;}
    if (params.output) {return false;}
    if (params.format && params.format !== 'terminal') {return false;}
    if (!params.ttyOut) {return false;}
    if (!params.scopeSupported) {return false;}
    return true;
}

export function shouldFailReview(
    result: ReviewResult,
    failOn?: string,
): boolean {
    if (!failOn) {
        return false;
    }

    const severityOrder: Record<string, number> = {
        info: 0,
        warning: 1,
        error: 2,
        critical: 3,
    };

    const threshold = severityOrder[failOn] ?? 0;
    return result.issues.some(
        (issue) => (severityOrder[issue.severity] ?? 0) >= threshold,
    );
}

export function formatFailOnExitMessage(
    result: ReviewResult,
    failOn?: string,
): string | null {
    if (!failOn) {
        return null;
    }

    const severityOrder: Record<string, number> = {
        info: 0,
        warning: 1,
        error: 2,
        critical: 3,
    };

    const threshold = severityOrder[failOn] ?? 0;
    const blockingCount = result.issues.filter(
        (issue) => (severityOrder[issue.severity] ?? 0) >= threshold,
    ).length;

    if (blockingCount === 0) {
        return null;
    }

    const issueLabel = blockingCount > 1 ? 'issues' : 'issue';
    const verbPhrase =
        blockingCount > 1 ? 'meet or exceed' : 'meets or exceeds';

    return `Exiting with code 1 because ${blockingCount} ${issueLabel} ${verbPhrase} \`--fail-on ${failOn}\`.`;
}

export function formatTrialCompletionMessage(
    result: TrialReviewResult,
): string {
    if (result.trialInfo) {
        return `Review complete! (Trial: ${result.trialInfo.reviewsUsed}/${result.trialInfo.reviewsLimit} reviews today)`;
    }

    if (result.rateLimit) {
        const used = Math.max(
            0,
            result.rateLimit.limit - result.rateLimit.remaining,
        );
        return `Review complete! (Trial: ${used}/${result.rateLimit.limit} reviews today)`;
    }

    return 'Review complete! (Trial mode)';
}
