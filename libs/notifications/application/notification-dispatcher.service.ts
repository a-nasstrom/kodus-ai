import { createLogger } from '@kodus/flow';
import { Inject, Injectable } from '@nestjs/common';

import { STATUS } from '@libs/core/infrastructure/config/types/database/status.type';
import {
    IUsersService,
    USER_SERVICE_TOKEN,
} from '@libs/identity/domain/user/contracts/user.service.contract';

import { NotificationEvent } from '../domain/catalog/events';
import { EVENT_DEFAULTS } from '../domain/catalog/defaults';
import {
    Criticality,
    DeliveryStatus,
    NotificationChannel,
    ACTIVE_CHANNELS,
} from '../domain/enums';
import {
    IChannelAdapter,
    NotificationDeliveryContext,
    CHANNEL_ADAPTERS_TOKEN,
} from '../domain/contracts/channel-adapter.contract';
import {
    INotificationDeliveryRepository,
    NOTIFICATION_DELIVERY_REPOSITORY_TOKEN,
} from '../domain/contracts/notification-delivery.repository.contract';
import {
    IRoutingRuleRepository,
    ROUTING_RULE_REPOSITORY_TOKEN,
} from '../domain/contracts/routing-rule.repository.contract';
import { NotificationRecipient } from '../domain/recipient';
import { NotificationSseService } from './notification-sse.service';

export interface NotificationMessage {
    event: NotificationEvent;
    payload: Record<string, unknown>;
    organizationId: string;
    /** Explicit recipients chosen by the emitter. Always an array on the wire. */
    recipients: NotificationRecipient[];
    correlationId: string;
}

interface ResolvedRecipient {
    userId: string;
    email: string;
    role: string;
}

/**
 * Worker-side fanout logic.
 *
 * 1. Resolve target users from payload context
 * 2. For each user: resolve routing rule → determine channels
 * 3. For each channel: create delivery record → call adapter → update status
 */
@Injectable()
export class NotificationDispatcherService {
    private readonly logger = createLogger(
        NotificationDispatcherService.name,
    );
    private readonly adapterMap: Map<NotificationChannel, IChannelAdapter>;

    constructor(
        @Inject(CHANNEL_ADAPTERS_TOKEN)
        private readonly adapters: IChannelAdapter[],
        @Inject(NOTIFICATION_DELIVERY_REPOSITORY_TOKEN)
        private readonly deliveryRepo: INotificationDeliveryRepository,
        @Inject(ROUTING_RULE_REPOSITORY_TOKEN)
        private readonly routingRuleRepo: IRoutingRuleRepository,
        @Inject(USER_SERVICE_TOKEN)
        private readonly usersService: IUsersService,
        private readonly sseService: NotificationSseService,
    ) {
        this.adapterMap = new Map(
            adapters
                .filter((a) => ACTIVE_CHANNELS.has(a.channel))
                .map((a) => [a.channel, a]),
        );
    }

    async dispatch(message: NotificationMessage): Promise<void> {
        const { event, payload, organizationId, correlationId } = message;
        const defaults = EVENT_DEFAULTS[event];

        if (!defaults) {
            this.logger.warn({
                message: `Unknown notification event: ${event}`,
                context: NotificationDispatcherService.name,
                metadata: { event, correlationId },
            });
            return;
        }

        const recipients = await this.resolveRecipients(
            message,
            organizationId,
        );

        for (const recipient of recipients) {
            await this.dispatchToRecipient(
                recipient,
                event,
                defaults,
                payload,
                organizationId,
                correlationId,
            );
        }
    }

    private async dispatchToRecipient(
        recipient: ResolvedRecipient,
        event: NotificationEvent,
        defaults: (typeof EVENT_DEFAULTS)[NotificationEvent],
        payload: Record<string, unknown>,
        organizationId: string,
        correlationId: string,
    ): Promise<void> {
        // System events use the catalog defaults verbatim (admins cannot
        // configure routing rules for them — see RoutingRuleService).
        // Critical events fan out across every active channel regardless
        // of stored configuration. Everything else respects the
        // per-role / wildcard / catalog-default chain.
        let enabledChannels: NotificationChannel[];
        if (defaults.criticality === Criticality.SYSTEM) {
            enabledChannels = [...defaults.defaultChannels].filter((ch) =>
                ACTIVE_CHANNELS.has(ch),
            );
        } else if (defaults.criticality === Criticality.CRITICAL) {
            enabledChannels = [...ACTIVE_CHANNELS];
        } else {
            enabledChannels = await this.resolveChannels(
                organizationId,
                event,
                recipient.role,
                defaults,
            );
        }

        const title = this.resolveTitle(event, payload);
        const body = this.resolveBody(event, payload);
        const ctaUrl = (payload.ctaUrl as string) ?? undefined;

        for (const channel of enabledChannels) {
            const adapter = this.adapterMap.get(channel);
            if (!adapter) continue;

            // The in-app channel writes a `user_notifications` row keyed
            // on a real user uuid. When the recipient is an email-only
            // fallback (e.g. signup confirmation to a not-yet-registered
            // address), there is no user to attach to — skip in-app and
            // let the email channel handle it.
            if (
                channel === NotificationChannel.IN_APP &&
                !recipient.userId
            ) {
                this.logger.warn({
                    message:
                        'Skipping in-app delivery: recipient has no user uuid',
                    context: NotificationDispatcherService.name,
                    metadata: {
                        event,
                        recipientEmail: recipient.email,
                        organizationId,
                        correlationId,
                    },
                });
                continue;
            }

            // Create delivery record (pending)
            const delivery = await this.deliveryRepo.create({
                organization: { uuid: organizationId },
                event,
                criticality: defaults.criticality,
                channel,
                title,
                body,
                ctaUrl,
                category: defaults.category,
                recipientEmail:
                    channel === NotificationChannel.EMAIL
                        ? recipient.email
                        : undefined,
                recipientUser: recipient.userId
                    ? { uuid: recipient.userId }
                    : undefined,
                deliveryStatus: DeliveryStatus.PENDING,
                metadata: payload,
                correlationId,
            });

            try {
                const context: NotificationDeliveryContext = {
                    deliveryId: delivery.uuid!,
                    userId: recipient.userId,
                    userEmail: recipient.email,
                    userRole: recipient.role,
                    organizationId,
                    event,
                    criticality: defaults.criticality,
                    title,
                    body,
                    ctaUrl,
                    category: defaults.category,
                    metadata: payload,
                    correlationId,
                };

                await adapter.deliver(context);
                await this.deliveryRepo.updateStatus(
                    delivery.uuid!,
                    DeliveryStatus.DELIVERED,
                );

                // Push SSE event for in-app channel
                if (channel === NotificationChannel.IN_APP) {
                    this.sseService.pushEvent(recipient.userId, {
                        type: 'notification',
                        data: {
                            id: delivery.uuid,
                            title,
                            category: defaults.category,
                            criticality: defaults.criticality,
                        },
                    });
                }
            } catch (error) {
                const errMsg =
                    error instanceof Error ? error.message : String(error);
                await this.deliveryRepo.updateStatus(
                    delivery.uuid!,
                    DeliveryStatus.FAILED,
                    errMsg,
                );
                this.logger.error({
                    message: `Channel delivery failed: ${channel}`,
                    error: error instanceof Error ? error : new Error(errMsg),
                    context: NotificationDispatcherService.name,
                    metadata: {
                        event,
                        channel,
                        userId: recipient.userId,
                        deliveryId: delivery.uuid,
                        correlationId,
                    },
                });
                // Isolated failure: don't block other channels
            }
        }
    }

    /**
     * Resolves the explicit recipients on the message envelope into the
     * shape the rest of the dispatcher needs. The emitter is required to
     * have set them — we do not try to infer recipients from payload
     * fields anymore.
     */
    private async resolveRecipients(
        message: NotificationMessage,
        organizationId: string,
    ): Promise<ResolvedRecipient[]> {
        if (!message.recipients?.length) {
            this.logger.warn({
                message:
                    'Notification message has no recipients — nothing to dispatch',
                context: NotificationDispatcherService.name,
                metadata: {
                    event: message.event,
                    correlationId: message.correlationId,
                },
            });
            return [];
        }

        const resolved: ResolvedRecipient[] = [];
        for (const r of message.recipients) {
            const entry =
                r.kind === 'user'
                    ? await this.resolveByUserId(r.userId)
                    : await this.resolveByEmail(r.email, organizationId);
            if (entry) resolved.push(entry);
        }
        return resolved;
    }

    private async resolveByUserId(
        userId: string,
    ): Promise<ResolvedRecipient | null> {
        const users = await this.usersService.find(
            { uuid: userId },
            [STATUS.ACTIVE],
        );
        if (!users?.length) {
            this.logger.warn({
                message:
                    'Notification recipient userId did not resolve to an active user — skipping',
                context: NotificationDispatcherService.name,
                metadata: { userId },
            });
            return null;
        }
        const u = users[0];
        return {
            userId: u.uuid,
            email: u.email,
            role: u.role ?? 'contributor',
        };
    }

    private async resolveByEmail(
        email: string,
        organizationId: string,
    ): Promise<ResolvedRecipient> {
        const users = await this.usersService.find(
            { email, organization: { uuid: organizationId } },
            [STATUS.ACTIVE],
        );
        if (users?.length) {
            return {
                userId: users[0].uuid,
                email: users[0].email,
                role: users[0].role ?? 'contributor',
            };
        }
        // No matching user — still emit on the email channel so flows
        // that target a not-yet-registered address (sign-up confirmation,
        // password reset, SSO verification) work. The in-app channel
        // will be skipped because there is no user uuid to attach to.
        this.logger.warn({
            message:
                'Notification recipient resolved by email-only fallback (no active user matched) — in-app channel will be skipped',
            context: NotificationDispatcherService.name,
            metadata: { email, organizationId },
        });
        return {
            userId: '',
            email,
            role: 'contributor',
        };
    }

    /**
     * Resolution priority for (event, role) channels:
     *   1. Per-role override row    (org, event, role)   — wins if present
     *   2. All Roles ('*') row      (org, event, '*')    — wins if present
     *   3. Catalog defaults         EVENT_DEFAULTS[event].defaultChannels
     *
     * The repository handles steps 1–2; this method handles step 3.
     * In all cases the result is intersected with ACTIVE_CHANNELS so
     * channels that exist in config but aren't built (slack, discord,
     * webhook) are dropped.
     */
    private async resolveChannels(
        organizationId: string,
        event: string,
        role: string,
        defaults: (typeof EVENT_DEFAULTS)[NotificationEvent],
    ): Promise<NotificationChannel[]> {
        const rule = await this.routingRuleRepo.resolve(
            organizationId,
            event,
            role,
        );

        if (rule) {
            return Object.entries(rule.channels)
                .filter(
                    ([ch, enabled]) =>
                        enabled &&
                        ACTIVE_CHANNELS.has(ch as NotificationChannel),
                )
                .map(([ch]) => ch as NotificationChannel);
        }

        return [...defaults.defaultChannels].filter((ch) =>
            ACTIVE_CHANNELS.has(ch),
        );
    }

    private resolveTitle(
        event: NotificationEvent,
        _payload: Record<string, unknown>,
    ): string {
        const defaults = EVENT_DEFAULTS[event];
        return defaults?.label ?? event;
    }

    private resolveBody(
        event: NotificationEvent,
        payload: Record<string, unknown>,
    ): string {
        // For in-app display. Email has its own template rendering.
        switch (event) {
            case NotificationEvent.AUTH_EMAIL_CONFIRMATION:
                return `Confirm your email for ${payload.organizationName ?? 'your organization'}.`;
            case NotificationEvent.AUTH_FORGOT_PASSWORD:
                return 'A password reset was requested for your account.';
            case NotificationEvent.TEAM_MEMBER_INVITED:
                return `You've been invited to join a team.`;
            case NotificationEvent.KODY_RULES_GENERATED:
                return `New Kody rules have been generated for ${payload.organizationName ?? 'your organization'}.`;
            case NotificationEvent.SSO_DOMAIN_VERIFICATION:
                return `Verify your SSO domain: ${payload.domain ?? ''}`;
            case NotificationEvent.WEEKLY_RECAP:
                return 'Your weekly engineering recap is ready.';
            default:
                return '';
        }
    }
}
