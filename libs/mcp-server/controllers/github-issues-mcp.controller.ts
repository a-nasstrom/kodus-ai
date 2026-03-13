import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    HttpStatus,
    Post,
    Res,
} from '@nestjs/common';
import {
    ApiBody,
    ApiHeader,
    ApiOperation,
    ApiProduces,
    ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';

import { createLogger } from '@kodus/flow';
import { GithubIssuesMcpServerService } from '../services/github-issues-mcp-server.service';
import { JsonRpcCode } from '../utils/errors';
import { toJsonRpcError } from '../utils/serialize';

function getJsonRpcId(body: any): string | number | null {
    return body && (typeof body.id === 'string' || typeof body.id === 'number')
        ? body.id
        : null;
}

function accepts(req: Request, mime: string) {
    const h = (req.headers['accept'] || '').toString().toLowerCase();
    return h.includes(mime.toLowerCase());
}

@ApiTags('MCP Github Issues')
@Controller('mcp/github-issues')
export class GithubIssuesMcpController {
    private readonly logger = createLogger(GithubIssuesMcpController.name);

    constructor(
        private readonly mcpServerService: GithubIssuesMcpServerService,
    ) {}

    @Post()
    @ApiOperation({
        summary: 'Handle GitHub Issues MCP client request',
    })
    @ApiHeader({
        name: 'accept',
        required: true,
    })
    @ApiHeader({
        name: 'mcp-session-id',
        required: false,
    })
    @ApiProduces('application/json', 'text/event-stream')
    @ApiBody({
        schema: {
            type: 'object',
            additionalProperties: true,
        },
    })
    async handleClientRequest(
        @Body() body: any,
        @Headers('mcp-session-id') sessionId: string | undefined,
        @Res() res: Response,
    ) {
        const id = getJsonRpcId(body);

        try {
            if (!accepts(res.req, 'application/json')) {
                return res.status(HttpStatus.NOT_ACCEPTABLE).json(
                    toJsonRpcError(
                        {
                            code: JsonRpcCode.INVALID_REQUEST,
                            message: 'Client must accept application/json',
                        },
                        id,
                    ),
                );
            }

            if (sessionId && this.mcpServerService.hasSession(sessionId)) {
                await this.mcpServerService.handleRequest(sessionId, body, res);
                return;
            }

            if (!sessionId && isInitializeRequest(body)) {
                const newSessionId =
                    await this.mcpServerService.createSession();
                await this.mcpServerService.handleRequest(
                    newSessionId,
                    body,
                    res,
                );
                return;
            }

            return res.status(HttpStatus.BAD_REQUEST).json(
                toJsonRpcError(
                    {
                        code: JsonRpcCode.INVALID_REQUEST,
                        message:
                            'Bad Request: missing or invalid Mcp-Session-Id',
                    },
                    id,
                ),
            );
        } catch (error) {
            this.logger.error({
                message: 'Error handling GitHub Issues MCP request',
                context: GithubIssuesMcpController.name,
                error,
                metadata: { sessionId, body },
            });

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
                toJsonRpcError(
                    {
                        code: JsonRpcCode.INTERNAL_ERROR,
                        message: 'Internal error',
                        data: { reason: 'controller-failure' },
                    },
                    id,
                ),
            );
        }
    }

    @Get()
    @ApiOperation({
        summary: 'Handle GitHub Issues MCP server notifications',
    })
    @ApiHeader({
        name: 'mcp-session-id',
        required: true,
    })
    @ApiProduces('text/event-stream')
    async handleServerNotifications(
        @Headers('mcp-session-id') sessionId: string | undefined,
        @Res() res: Response,
    ) {
        if (!accepts(res.req, 'text/event-stream')) {
            return res
                .status(HttpStatus.NOT_ACCEPTABLE)
                .send('Client must accept text/event-stream');
        }

        if (!sessionId || !this.mcpServerService.hasSession(sessionId)) {
            return res
                .status(HttpStatus.BAD_REQUEST)
                .send('Invalid or missing session ID');
        }

        await this.mcpServerService.handleServerNotifications(sessionId, res);
    }

    @Delete()
    @ApiOperation({
        summary: 'Terminate GitHub Issues MCP session',
    })
    @ApiHeader({
        name: 'mcp-session-id',
        required: true,
    })
    async handleSessionTermination(
        @Headers('mcp-session-id') sessionId: string | undefined,
        @Res() res: Response,
    ) {
        if (!sessionId || !this.mcpServerService.hasSession(sessionId)) {
            return res
                .status(HttpStatus.BAD_REQUEST)
                .send('Invalid or missing session ID');
        }

        await this.mcpServerService.terminateSession(sessionId, res);
    }
}
