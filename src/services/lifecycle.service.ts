import { createRequire } from 'node:module';
import { gitService } from './git.service.js';
import { hookLogger } from './hook-logger.service.js';
import { transcriptService } from './transcript.service.js';
import {
    saveLocal,
    loadLocal,
    removeLocal,
    listStaleSessions,
} from './session-local.service.js';
import { api } from './api/index.js';
import type {
    LifecycleEvent,
    AgentType,
    TokenUsage,
    ToolCall,
    FileChange,
} from '../types/session.js';
import type { SessionApiEvent } from '../types/session-events.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

async function getBranch(): Promise<string> {
    try {
        return (await gitService.getCurrentBranch()).trim();
    } catch {
        return '';
    }
}

async function getHead(): Promise<string> {
    return (await gitService.getHeadSha()) ?? '';
}

async function getRemote(): Promise<string> {
    return (await gitService.getRemoteUrl()) ?? '';
}

function sendEvent(event: SessionApiEvent, repoRoot: string): void {
    // Fire and forget — never blocks the agent
    api.sessions.sendEvent(event, repoRoot).catch(() => {});
}

class LifecycleService {
    async dispatch(
        repoRoot: string,
        agentType: AgentType,
        event: LifecycleEvent,
    ): Promise<void> {
        await hookLogger.init(repoRoot);

        switch (event.type) {
            case 'SessionStart':
                await this.handleSessionStart(repoRoot, agentType, event);
                break;
            case 'TurnStart':
                await this.handleTurnStart(repoRoot, agentType, event);
                break;
            case 'TurnEnd':
                await this.handleTurnEnd(repoRoot, agentType, event);
                break;
            case 'SessionEnd':
                await this.handleSessionEnd(repoRoot, agentType, event);
                break;
            case 'SubagentStart':
                await this.handleSubagentStart(repoRoot, agentType, event);
                break;
            case 'SubagentEnd':
                await this.handleSubagentEnd(repoRoot, agentType, event);
                break;
        }
    }

    // -------------------------------------------------------------------------
    // Session Start
    // -------------------------------------------------------------------------

    private async handleSessionStart(
        repoRoot: string,
        agentType: AgentType,
        event: LifecycleEvent,
    ): Promise<void> {
        await hookLogger.info('session-start', 'lifecycle', {
            agent: agentType,
            model_session_id: event.sessionId,
            transcript_path: event.sessionRef,
        });

        // Clean up stale sessions from previous crashes (> 30 min old)
        await this.cleanupStaleSessions(repoRoot, agentType);

        const [branch, baseCommit, gitRemote] = await Promise.all([
            getBranch(),
            getHead(),
            getRemote(),
        ]);

        sendEvent(
            {
                type: 'session_start',
                sessionId: event.sessionId,
                branch,
                timestamp: new Date().toISOString(),
                agentType,
                gitRemote,
                baseCommit,
                cliVersion: pkg.version,
            },
            repoRoot,
        );
    }

    // -------------------------------------------------------------------------
    // Turn Start (user-prompt-submit)
    // -------------------------------------------------------------------------

    private async handleTurnStart(
        repoRoot: string,
        agentType: AgentType,
        event: LifecycleEvent,
    ): Promise<void> {
        await hookLogger.info('turn-start', 'lifecycle', {
            agent: agentType,
            model_session_id: event.sessionId,
            prompt: event.prompt?.slice(0, 200),
        });

        const [branch, commitBefore] = await Promise.all([
            getBranch(),
            getHead(),
        ]);

        const turnId = `${Date.now()}`;

        // Save local state for correlation on TurnEnd
        const transcriptPath = event.sessionRef ?? '';
        let transcriptOffset = 0;
        if (transcriptPath) {
            try {
                const fs = await import('fs/promises');
                const s = await fs.stat(transcriptPath);
                transcriptOffset = s.size;
            } catch {
                // File may not exist yet
            }
        }

        await saveLocal(repoRoot, event.sessionId, {
            turnId,
            transcriptPath,
            transcriptOffset,
        });

        sendEvent(
            {
                type: 'turn_start',
                sessionId: event.sessionId,
                branch,
                timestamp: new Date().toISOString(),
                turnId,
                prompt: event.prompt ?? '',
                commitBefore,
            },
            repoRoot,
        );
    }

    // -------------------------------------------------------------------------
    // Turn End (stop / post-todo)
    // -------------------------------------------------------------------------

    private async handleTurnEnd(
        repoRoot: string,
        agentType: AgentType,
        event: LifecycleEvent,
    ): Promise<void> {
        await hookLogger.info('turn-end', 'lifecycle', {
            agent: agentType,
            model_session_id: event.sessionId,
        });

        const local = await loadLocal(repoRoot, event.sessionId);

        // Dedup: if this turn was already completed (e.g. Stop + PostToolUse
        // both firing TurnEnd), skip the duplicate.
        if (local?.turnCompleted) {
            await hookLogger.info('turn-end-dedup-skipped', 'lifecycle', {
                agent: agentType,
                model_session_id: event.sessionId,
                turn_id: local.turnId,
            });
            return;
        }

        const transcriptPath = local?.transcriptPath ?? event.sessionRef ?? '';
        const transcriptOffset = local?.transcriptOffset ?? 0;

        // When local state is missing it means turn_start never fired
        // (e.g. UserPromptSubmit hook didn't trigger). Generate a synthetic
        // turn_start so the backend always receives a matching pair.
        const turnId = local?.turnId ?? `${Date.now()}`;
        if (!local) {
            await hookLogger.warn('turn-end-without-turn-start', 'lifecycle', {
                agent: agentType,
                model_session_id: event.sessionId,
                synthetic_turn_id: turnId,
            });

            const [synthBranch, synthCommit] = await Promise.all([
                getBranch(),
                getHead(),
            ]);

            sendEvent(
                {
                    type: 'turn_start',
                    sessionId: event.sessionId,
                    branch: synthBranch,
                    timestamp: new Date().toISOString(),
                    turnId,
                    prompt: '',
                    commitBefore: synthCommit,
                },
                repoRoot,
            );
        }

        const emptyTokenUsage: TokenUsage = {
            inputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 0,
            apiCallCount: 0,
        };

        let toolCalls: ToolCall[] = [];
        let filesModified: FileChange[] = [];
        let filesRead: string[] = [];
        let commands: string[] = [];
        let tokenUsage = emptyTokenUsage;
        let response = '';

        if (transcriptPath) {
            const flushed = await transcriptService.waitForFlush(
                transcriptPath,
                3000,
            );
            if (flushed) {
                try {
                    const parseResult = await transcriptService.parse(
                        transcriptPath,
                        transcriptOffset,
                    );
                    toolCalls = parseResult.toolCalls;
                    filesRead = parseResult.filesRead;
                    commands = parseResult.commands;
                    tokenUsage = parseResult.tokenUsage;
                    filesModified = parseResult.modifiedFiles.map((p) => ({
                        path: p,
                        action: 'modified' as const,
                    }));
                    response = parseResult.assistantMessages.join('\n\n');
                } catch (error) {
                    await hookLogger.warn(
                        'transcript-parse-error',
                        'transcript',
                        {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        },
                    );
                }
            }
        }

        const [branch, commitAfter] = await Promise.all([
            getBranch(),
            getHead(),
        ]);

        // Mark turn as completed BEFORE sending the event to prevent
        // duplicate turn_end from Stop + PostToolUse(TodoWrite) both firing.
        // Save even for synthetic turns (when local was null) so subsequent
        // TurnEnd calls for the same session are deduped.
        await saveLocal(repoRoot, event.sessionId, {
            turnId,
            transcriptPath,
            transcriptOffset,
            turnCompleted: true,
        });

        sendEvent(
            {
                type: 'turn_end',
                sessionId: event.sessionId,
                branch,
                timestamp: new Date().toISOString(),
                turnId,
                response,
                toolCalls,
                filesModified,
                filesRead,
                commands,
                tokenUsage,
                commitAfter,
            },
            repoRoot,
        );
    }

    // -------------------------------------------------------------------------
    // Session End
    // -------------------------------------------------------------------------

    private async handleSessionEnd(
        repoRoot: string,
        agentType: AgentType,
        event: LifecycleEvent,
    ): Promise<void> {
        await hookLogger.info('session-end', 'lifecycle', {
            agent: agentType,
            model_session_id: event.sessionId,
        });

        const branch = await getBranch();

        sendEvent(
            {
                type: 'session_end',
                sessionId: event.sessionId,
                branch,
                timestamp: new Date().toISOString(),
            },
            repoRoot,
        );

        // Clean up local session file
        await removeLocal(repoRoot, event.sessionId);
    }

    // -------------------------------------------------------------------------
    // Subagent Start (pre-task)
    // -------------------------------------------------------------------------

    private async handleSubagentStart(
        repoRoot: string,
        agentType: AgentType,
        event: LifecycleEvent,
    ): Promise<void> {
        await hookLogger.info('subagent-start', 'lifecycle', {
            agent: agentType,
            model_session_id: event.sessionId,
            tool_use_id: event.toolUseId,
            subagent_type: event.subagentType,
            task_description: event.taskDescription?.slice(0, 200),
        });

        if (!event.toolUseId) {
            return;
        }

        const branch = await getBranch();

        // subagentType/taskDescription may live inside toolInput (Claude Code payload)
        const toolInput =
            event.toolInput && typeof event.toolInput === 'object'
                ? (event.toolInput as Record<string, unknown>)
                : {};
        const subagentType =
            event.subagentType ??
            pickString(toolInput, 'subagent_type', 'subagentType') ??
            'unknown';
        const taskDescription =
            event.taskDescription ??
            pickString(
                toolInput,
                'task_description',
                'taskDescription',
                'description',
                'prompt',
            ) ??
            '';

        sendEvent(
            {
                type: 'subagent_start',
                sessionId: event.sessionId,
                branch,
                timestamp: new Date().toISOString(),
                toolUseId: event.toolUseId,
                subagentType,
                taskDescription,
            },
            repoRoot,
        );
    }

    // -------------------------------------------------------------------------
    // Stale Session Cleanup
    // -------------------------------------------------------------------------

    private async cleanupStaleSessions(
        repoRoot: string,
        agentType: AgentType,
    ): Promise<void> {
        const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
        try {
            const stale = await listStaleSessions(repoRoot, STALE_THRESHOLD_MS);
            if (stale.length === 0) {
                return;
            }

            const branch = await getBranch();

            for (const { sessionId } of stale) {
                await hookLogger.info('stale-session-cleanup', 'lifecycle', {
                    agent: agentType,
                    stale_session_id: sessionId,
                });

                sendEvent(
                    {
                        type: 'session_end',
                        sessionId,
                        branch,
                        timestamp: new Date().toISOString(),
                    },
                    repoRoot,
                );

                await removeLocal(repoRoot, sessionId);
            }
        } catch {
            // Best-effort cleanup — never block the current session
        }
    }

    // -------------------------------------------------------------------------
    // Subagent End (post-task)
    // -------------------------------------------------------------------------

    private async handleSubagentEnd(
        repoRoot: string,
        agentType: AgentType,
        event: LifecycleEvent,
    ): Promise<void> {
        await hookLogger.info('subagent-end', 'lifecycle', {
            agent: agentType,
            model_session_id: event.sessionId,
            tool_use_id: event.toolUseId,
        });

        if (!event.toolUseId) {
            return;
        }

        const branch = await getBranch();

        sendEvent(
            {
                type: 'subagent_end',
                sessionId: event.sessionId,
                branch,
                timestamp: new Date().toISOString(),
                toolUseId: event.toolUseId,
            },
            repoRoot,
        );
    }
}

function pickString(
    obj: Record<string, unknown>,
    ...keys: string[]
): string | undefined {
    for (const key of keys) {
        const val = obj[key];
        if (typeof val === 'string' && val.trim()) {
            return val.trim();
        }
    }
    return undefined;
}

export const lifecycleService = new LifecycleService();
