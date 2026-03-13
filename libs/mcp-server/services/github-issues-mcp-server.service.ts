import { createLogger } from '@kodus/flow';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { nanoid } from 'nanoid';

import { GithubIssuesTools } from '../tools/githubIssues.tools';
import { toShape } from '../types/mcp-tool.interface';

interface McpSession {
    id: string;
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    createdAt: Date;
}

@Injectable()
export class GithubIssuesMcpServerService {
    private readonly logger = createLogger(GithubIssuesMcpServerService.name);
    private sessions: Map<string, McpSession> = new Map();

    constructor(private readonly githubIssuesTools: GithubIssuesTools) {}

    async createSession(): Promise<string> {
        const sessionId = nanoid();

        const server = new McpServer(
            {
                name: 'github-issues-by-kodus',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            },
        );

        this.registerTools(server);

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId,
        });

        transport.onclose = () => {
            this.sessions.delete(sessionId);
            this.logger.log({
                message: 'GitHub Issues MCP session closed',
                context: GithubIssuesMcpServerService.name,
                metadata: { sessionId },
            });
        };

        await server.connect(transport);

        this.sessions.set(sessionId, {
            id: sessionId,
            server,
            transport,
            createdAt: new Date(),
        });

        this.logger.log({
            message: 'GitHub Issues MCP session created',
            context: GithubIssuesMcpServerService.name,
            metadata: { sessionId },
        });

        return sessionId;
    }

    private registerTools(server: McpServer): void {
        const allTools = this.githubIssuesTools.getAllTools();

        for (const tool of allTools) {
            server.registerTool(
                tool.name,
                {
                    description: tool.description,
                    inputSchema: toShape(tool.inputSchema)!,
                    outputSchema: toShape(tool.outputSchema),
                    annotations: tool?.annotations,
                },
                tool.execute as (
                    args: Record<string, unknown>,
                    extra: unknown,
                ) => Promise<CallToolResult>,
            );
        }

        this.logger.log({
            message: 'Registered GitHub Issues MCP tools',
            context: GithubIssuesMcpServerService.name,
            metadata: { toolCount: allTools.length },
        });
    }

    hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    async handleRequest(
        sessionId: string,
        body: any,
        res: Response,
    ): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        await session.transport.handleRequest(res.req, res, body);
    }

    async handleServerNotifications(
        sessionId: string,
        res: Response,
    ): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        await session.transport.handleRequest(res.req, res);
    }

    async terminateSession(sessionId: string, res: Response): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        await session.transport.handleRequest(res.req, res);
        session.transport.close();
        this.sessions.delete(sessionId);
    }

    getAvailableToolsCount(): number {
        return this.githubIssuesTools.getAllTools().length;
    }
}
