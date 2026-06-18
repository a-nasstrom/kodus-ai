import { createLogger } from '@kodus/flow';
import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import { MCPManagerService } from '@libs/mcp-server/services/mcp-manager.service';

const logger = createLogger('ConnectedTaskManagementMcps');

const TASK_MANAGEMENT_HINTS = [
    'jira',
    'linear',
    'notion',
    'clickup',
    'googledocs',
    'atlassianrovo',
    'githubissues',
] as const;

export async function getConnectedTaskManagementMcps(
    mcpManagerService: MCPManagerService,
    organizationAndTeamData: OrganizationAndTeamData | undefined,
): Promise<string[]> {
    try {
        const orgId = organizationAndTeamData?.organizationId;
        const matched: string[] = [];

        const allConnections = await mcpManagerService.getConnections(
            organizationAndTeamData,
            false,
        );

        for (const conn of (allConnections ?? []).filter(
            (c) => c.organizationId === orgId,
        )) {
            appendTaskManagementHints(matched, [
                conn.appName,
                conn.provider,
                conn.integrationId,
            ]);
        }

        const integrations = await mcpManagerService.getIntegrations(
            organizationAndTeamData,
        );

        for (const integration of integrations ?? []) {
            if (integration.isDefault) {
                continue;
            }

            const isUsable =
                integration.isConnected === true ||
                integration.active === true;
            if (!isUsable) {
                continue;
            }

            appendTaskManagementHints(matched, [
                integration.id,
                integration.appName,
                integration.name,
                integration.provider,
            ]);
        }

        return matched;
    } catch (error) {
        logger.warn({
            message: `Failed to fetch task-management MCP connections: ${error instanceof Error ? error.message : String(error)}`,
            error,
        });
        return [];
    }
}

function appendTaskManagementHints(
    matched: string[],
    aliases: Array<string | undefined>,
): void {
    for (const hint of matchTaskManagementHints(aliases)) {
        if (!matched.includes(hint)) {
            matched.push(hint);
        }
    }
}

function normalizeMcpAlias(value: string | undefined): string {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function matchTaskManagementHints(
    aliases: Array<string | undefined>,
): string[] {
    const matched: string[] = [];

    for (const raw of aliases) {
        const alias = normalizeMcpAlias(raw);
        if (!alias) {
            continue;
        }

        const hint = TASK_MANAGEMENT_HINTS.find(
            (h) => alias.includes(h) || h.includes(alias),
        );
        if (hint && !matched.includes(hint)) {
            matched.push(hint);
        }
    }

    return matched;
}
