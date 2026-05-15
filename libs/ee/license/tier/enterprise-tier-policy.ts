import {
    OrganizationLicenseValidationResult,
    SubscriptionStatus,
} from '../interfaces/license.interface';

/**
 * Enterprise tier policy — single source of truth for "who can access
 * enterprise-only features" (SSO config, user activity logs). Keep the
 * frontend copy in `apps/web/src/features/ee/byok/_utils.ts`
 * (`isEnterprisePlan`) aligned with this when the rule changes.
 *
 * Allowed:
 *   - self-hosted (any) — historically full feature set
 *   - licensed self-hosted (any)
 *   - trial (treated as enterprise preview)
 *   - cloud paid (active) on enterprise plans
 *
 * Blocked:
 *   - canceled / expired / payment_failed
 *   - cloud paid (active) on non-enterprise plans
 *   - invalid licenses
 */
export function isEnterpriseTierAllowed(
    license: OrganizationLicenseValidationResult | null | undefined,
): boolean {
    if (!license) return false;

    switch (license.subscriptionStatus) {
        case SubscriptionStatus.SELF_HOSTED:
        case SubscriptionStatus.LICENSED_SELF_HOSTED:
        case SubscriptionStatus.TRIAL:
            return true;
        case SubscriptionStatus.ACTIVE: {
            const plan = license.planType ?? '';
            return plan.startsWith('enterprise');
        }
        default:
            return false;
    }
}
