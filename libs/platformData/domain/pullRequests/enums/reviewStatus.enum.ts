/**
 * High-level outcome of an agent-engine code review run, persisted on the
 * PR record so the auto-approve cron and the dashboard can tell apart a
 * legitimately clean review from one that failed to analyze the PR (e.g.
 * BYOK key out of credits).
 *
 *  - SUCCESS: main agent ran successfully. 0 suggestions counts as SUCCESS.
 *  - PARTIAL: main agent succeeded but kody-rules agent failed. Review still
 *    has value; auto-approve allowed.
 *  - FAILED:  main agent failed with a mapped error (auth / quota / etc).
 *    Review has no value; auto-approve must wait for a successful re-run.
 *
 * Absent on legacy (non-agent) engine runs.
 */
export enum ReviewStatus {
    SUCCESS = 'success',
    PARTIAL = 'partial',
    FAILED = 'failed',
}
