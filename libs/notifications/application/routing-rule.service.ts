import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { NotificationEvent } from '../domain/catalog/events';
import { EVENT_DEFAULTS } from '../domain/catalog/defaults';
import {
    Criticality,
    ACTIVE_CHANNELS,
    NotificationChannel,
} from '../domain/enums';
import {
    IRoutingRuleRepository,
    ROUTING_RULE_REPOSITORY_TOKEN,
} from '../domain/contracts/routing-rule.repository.contract';
import { IRoutingRule } from '../domain/interfaces/routing-rule.interface';

export interface UpsertRuleDto {
    event: string;
    role: string;
    channels: Record<string, boolean>;
    /**
     * When true, removes the (event, role) routing rule for this org so it
     * inherits from the wildcard rule. Used by the admin UI to revert a
     * per-role override.
     */
    delete?: boolean;
}

/**
 * CRUD for owner-managed routing rules + critical event enforcement.
 */
@Injectable()
export class RoutingRuleService {
    constructor(
        @Inject(ROUTING_RULE_REPOSITORY_TOKEN)
        private readonly routingRuleRepo: IRoutingRuleRepository,
    ) {}

    async findByOrganization(organizationId: string): Promise<IRoutingRule[]> {
        return this.routingRuleRepo.findByOrganization(organizationId);
    }

    /**
     * Static catalog metadata for the admin UI: every known event with its
     * label, category, criticality and the channels enabled by default when
     * no routing rule exists. The dispatcher uses these same defaults at
     * runtime — so the UI can reflect actual delivery behaviour for events
     * with no explicit rule.
     */
    getCatalog(): Array<{
        event: string;
        label: string;
        category: string;
        criticality: Criticality;
        defaultChannels: Record<string, boolean>;
    }> {
        return Object.entries(EVENT_DEFAULTS).map(([event, defaults]) => {
            const defaultChannels: Record<string, boolean> = {};
            for (const ch of ACTIVE_CHANNELS) {
                defaultChannels[ch] = defaults.defaultChannels.has(ch);
            }
            return {
                event,
                label: defaults.label,
                category: defaults.category,
                criticality: defaults.criticality,
                defaultChannels,
            };
        });
    }

    async upsertRules(
        organizationId: string,
        rules: UpsertRuleDto[],
    ): Promise<IRoutingRule[]> {
        for (const rule of rules) {
            const eventDefaults =
                EVENT_DEFAULTS[rule.event as NotificationEvent];
            if (!eventDefaults) continue;

            // System events are non-configurable: their channels come
            // from the catalog defaults and cannot be overridden.
            if (eventDefaults.criticality === Criticality.SYSTEM) {
                throw new BadRequestException(
                    `Cannot configure routing for system event "${rule.event}". System notifications use catalog defaults.`,
                );
            }

            // Skip channel checks for deletes — the row is going away.
            if (rule.delete) continue;

            // Critical events: cannot disable any active channel.
            if (eventDefaults.criticality === Criticality.CRITICAL) {
                const disabledChannels = Object.entries(rule.channels)
                    .filter(
                        ([ch, enabled]) =>
                            !enabled &&
                            ACTIVE_CHANNELS.has(ch as NotificationChannel),
                    )
                    .map(([ch]) => ch);

                if (disabledChannels.length > 0) {
                    throw new BadRequestException(
                        `Cannot disable channels [${disabledChannels.join(', ')}] for critical event "${rule.event}". Critical notifications must be delivered on all active channels.`,
                    );
                }
            }
        }

        const toDelete = rules.filter((r) => r.delete);
        const toUpsert = rules.filter((r) => !r.delete);

        for (const r of toDelete) {
            // Wildcard rules are the global config and cannot be "removed" via
            // override-revert — only specific-role rows are deletable here.
            if (r.role === '*') {
                throw new BadRequestException(
                    `Cannot delete wildcard routing rule for "${r.event}". The All Roles config is the global default.`,
                );
            }
            await this.routingRuleRepo.deleteByOrgEventRole(
                organizationId,
                r.event,
                r.role,
            );
        }

        if (toUpsert.length === 0) {
            return this.findByOrganization(organizationId);
        }

        return this.routingRuleRepo.upsertBatch(
            toUpsert.map((r) => ({
                organization: { uuid: organizationId },
                event: r.event,
                role: r.role,
                category:
                    EVENT_DEFAULTS[r.event as NotificationEvent]?.category ??
                    null,
                channels: r.channels,
            })),
        );
    }

    /**
     * Seed default routing rules for a new organization.
     * Called once when the org is created. System events are skipped — they
     * are non-configurable and the dispatcher hardcodes them to email-only.
     */
    async seedDefaults(organizationId: string): Promise<IRoutingRule[]> {
        const rules: Array<
            Omit<IRoutingRule, 'uuid' | 'createdAt' | 'updatedAt'>
        > = [];

        for (const [event, defaults] of Object.entries(EVENT_DEFAULTS)) {
            if (defaults.criticality === Criticality.SYSTEM) continue;

            const channels: Record<string, boolean> = {};
            for (const ch of ACTIVE_CHANNELS) {
                channels[ch] = defaults.defaultChannels.has(ch);
            }

            // Seed for wildcard role — applies to all roles by default
            rules.push({
                organization: { uuid: organizationId },
                event,
                category: defaults.category,
                role: '*',
                channels,
            });
        }

        return this.routingRuleRepo.upsertBatch(rules);
    }

    async resetToDefaults(organizationId: string): Promise<IRoutingRule[]> {
        await this.routingRuleRepo.deleteByOrganization(organizationId);
        return this.seedDefaults(organizationId);
    }
}
