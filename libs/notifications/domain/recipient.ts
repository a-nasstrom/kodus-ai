/**
 * Discriminated union describing who should receive a notification.
 *
 * Every emitter is now required to pass at least one recipient — the
 * dispatcher no longer infers recipients by introspecting the payload.
 *
 * Use the helpers below for ergonomic construction:
 *
 * ```ts
 * await notificationService.emit({
 *   event: NotificationEvent.AUTH_FORGOT_PASSWORD,
 *   payload: { ... },
 *   organizationId,
 *   recipients: recipientByUser(user.uuid),
 * });
 * ```
 */
export type NotificationRecipient =
    | { kind: 'user'; userId: string }
    | { kind: 'email'; email: string };

export const recipientByUser = (userId: string): NotificationRecipient => ({
    kind: 'user',
    userId,
});

export const recipientByEmail = (email: string): NotificationRecipient => ({
    kind: 'email',
    email,
});
