/** Minimal shape of a BYOK config slot — just the model id we price-check. */
interface ByokModelSlots {
    main?: { model?: string };
    fallback?: { model?: string };
}

/**
 * Assemble the distinct, non-blank model ids that a spend limit must be able
 * to price: the BYOK `main` and `fallback` models, plus any extra models the
 * caller supplies (e.g. per-repository / per-directory `byokModel` overrides).
 */
export function collectByokModels(
    byokConfig?: ByokModelSlots | null,
    extraModels: string[] = [],
): string[] {
    const candidates = [
        byokConfig?.main?.model,
        byokConfig?.fallback?.model,
        ...extraModels,
    ];

    return [
        ...new Set(
            candidates
                .map((m) => m?.trim())
                .filter((m): m is string => Boolean(m)),
        ),
    ];
}
