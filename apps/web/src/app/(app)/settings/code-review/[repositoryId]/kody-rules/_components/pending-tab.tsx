"use client";

import { IssueSeverityLevelBadge } from "@components/system/issue-severity-level-badge";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card, CardContent, CardHeader } from "@components/ui/card";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleIndicator,
    CollapsibleTrigger,
} from "@components/ui/collapsible";
import { Markdown } from "@components/ui/markdown";
import { toast } from "@components/ui/toaster/use-toast";
import {
    applyPendingKodyRules,
    convertPendingUpdatesToNew,
    discardPendingKodyRules,
} from "@services/kodyRules/fetch";
import {
    KodyRule,
    KodyRuleRequestType,
    KodyRulesType,
} from "@services/kodyRules/types";
import { isCentralizedPrResponse } from "@services/parameters/types";

import { getCentralizedPrToastPayload } from "../../../_utils/centralized-pr-feedback";
import { OriginBadge } from "./origin-badge";

const isMemory = (rule: KodyRule) =>
    (rule.type ?? KodyRulesType.STANDARD) === KodyRulesType.MEMORY;

const isUpdateRequest = (rule: KodyRule) =>
    rule.requestType === KodyRuleRequestType.UPDATE;

const entityNoun = (rule: KodyRule) => (isMemory(rule) ? "memory" : "rule");

/** Before/after row — renders only when the value actually changed. */
const DiffRow = ({
    label,
    previous,
    next,
}: {
    label: string;
    previous?: string | null;
    next?: string | null;
}) => {
    const before = previous?.trim() || "—";
    const after = next?.trim() || "—";
    if (before === after) return null;

    return (
        <div className="flex flex-col gap-2">
            <div className="text-text-secondary text-xs font-semibold tracking-wide uppercase">
                {label}
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div className="bg-danger-background text-danger border-danger/30 rounded-md border px-3 py-2 text-sm whitespace-pre-wrap">
                    <span className="mr-2 font-semibold">-</span>
                    {before}
                </div>
                <div className="bg-success-background text-success border-success/30 rounded-md border px-3 py-2 text-sm whitespace-pre-wrap">
                    <span className="mr-2 font-semibold">+</span>
                    {after}
                </div>
            </div>
        </div>
    );
};

const Header = ({
    rule,
    title,
    update,
}: {
    rule: KodyRule;
    title: string;
    update?: boolean;
}) => (
    <CardHeader className="flex flex-row items-center gap-3 px-5 py-4">
        <Badge active size="xs" className="min-h-auto">
            {isMemory(rule) ? "Memory" : "Rule"}
        </Badge>

        <span className="flex-1 truncate font-medium">{title}</span>

        <div className="flex items-center gap-3">
            <OriginBadge rule={rule} />
            {!isMemory(rule) && (
                <IssueSeverityLevelBadge severity={rule.severity} />
            )}
            {update && (
                <Badge active size="xs" className="min-h-auto">
                    Update
                </Badge>
            )}
            <CollapsibleTrigger asChild>
                <Button active size="icon-sm" variant="helper">
                    <CollapsibleIndicator />
                </Button>
            </CollapsibleTrigger>
        </div>
    </CardHeader>
);

/**
 * Always-visible Pending area: every pending Kody Rule and Memory in one list,
 * with its origin. Create-requests offer approve / discard; update-requests
 * show a diff against the rule/memory they target and offer "update existing",
 * "create new instead", or discard.
 */
export const PendingTab = ({
    pendingRules,
    activeRules,
    teamId,
    canEdit,
    refreshRulesList,
}: {
    pendingRules: KodyRule[];
    activeRules: KodyRule[];
    teamId: string;
    canEdit: boolean;
    refreshRulesList: () => void;
}) => {
    const targetsById = new Map(
        activeRules.filter((r) => r.uuid).map((r) => [r.uuid, r]),
    );

    const run = async (
        action: () => Promise<unknown>,
        centralizedMessage: string,
    ) => {
        try {
            const response = await action();
            if (isCentralizedPrResponse(response)) {
                toast(
                    getCentralizedPrToastPayload(response, centralizedMessage),
                );
            }
        } catch (error) {
            console.error("Error processing pending item:", error);
            toast({
                title: "Error",
                description: "Could not process the pending item.",
                variant: "danger",
            });
        } finally {
            refreshRulesList();
        }
    };

    const approve = (r: KodyRule) =>
        run(
            () => applyPendingKodyRules(teamId, [r.uuid!]),
            "Change proposed through centralized pull request.",
        );

    const discard = (r: KodyRule) =>
        run(
            () => discardPendingKodyRules(teamId, [r.uuid!]),
            "Discard proposed through centralized pull request.",
        );

    const createInstead = (r: KodyRule) =>
        run(
            () => convertPendingUpdatesToNew(teamId, [r.uuid!]),
            "New item proposed through centralized pull request.",
        );

    if (pendingRules.length === 0) {
        return (
            <div className="text-text-secondary flex flex-col items-center gap-1 py-12 text-sm">
                <span className="text-text-primary font-medium">
                    Nothing pending
                </span>
                <span>
                    Generated, imported, and proposed rules and memories show up
                    here for review.
                </span>
            </div>
        );
    }

    return (
        <div className="flex w-full flex-col gap-2">
            {pendingRules.map((r) => {
                if (!r.uuid) return null;

                if (isUpdateRequest(r)) {
                    const target = r.targetRuleUuid
                        ? targetsById.get(r.targetRuleUuid)
                        : undefined;

                    return (
                        <Card key={r.uuid}>
                            <Collapsible className="w-full">
                                <Header
                                    rule={r}
                                    title={target?.title || r.title}
                                    update
                                />
                                <CollapsibleContent asChild className="pb-0">
                                    <CardContent className="bg-card-lv1 flex flex-col gap-4 pt-4">
                                        {!target ? (
                                            <div className="text-warning text-sm">
                                                Target {entityNoun(r)} was not
                                                found in the current list —
                                                review carefully.
                                            </div>
                                        ) : (
                                            <>
                                                <DiffRow
                                                    label="Title"
                                                    previous={target.title}
                                                    next={r.title}
                                                />
                                                <DiffRow
                                                    label="Rule"
                                                    previous={target.rule}
                                                    next={r.rule}
                                                />
                                                <DiffRow
                                                    label="Path"
                                                    previous={target.path}
                                                    next={r.path}
                                                />
                                            </>
                                        )}

                                        <div className="flex flex-wrap justify-end gap-2 pt-2">
                                            <Button
                                                size="sm"
                                                variant="helper"
                                                disabled={!canEdit}
                                                onClick={() => createInstead(r)}>
                                                Create new instead
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="cancel"
                                                disabled={!canEdit}
                                                onClick={() => discard(r)}>
                                                Discard
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="primary"
                                                disabled={!canEdit}
                                                onClick={() => approve(r)}>
                                                Update existing
                                            </Button>
                                        </div>
                                    </CardContent>
                                </CollapsibleContent>
                            </Collapsible>
                        </Card>
                    );
                }

                // Create-request — a brand-new rule/memory, nothing to diff.
                return (
                    <Card key={r.uuid}>
                        <Collapsible className="w-full">
                            <Header rule={r} title={r.title} />
                            <CollapsibleContent asChild className="pb-0">
                                <CardContent className="bg-card-lv1 flex flex-col gap-5 pt-4">
                                    <Markdown>{r.rule}</Markdown>

                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button
                                            size="sm"
                                            variant="cancel"
                                            disabled={!canEdit}
                                            onClick={() => discard(r)}>
                                            Discard
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="primary"
                                            disabled={!canEdit}
                                            onClick={() => approve(r)}>
                                            Approve
                                        </Button>
                                    </div>
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>
                );
            })}
        </div>
    );
};
