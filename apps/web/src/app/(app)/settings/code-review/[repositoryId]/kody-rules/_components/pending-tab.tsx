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

/**
 * Always-visible Pending area: every pending Kody Rule and Memory in one list,
 * with its origin, and the approve / discard / "create instead" actions —
 * regardless of how many are pending (no conditional buttons).
 */
export const PendingTab = ({
    pendingRules,
    teamId,
    canEdit,
    refreshRulesList,
}: {
    pendingRules: KodyRule[];
    teamId: string;
    canEdit: boolean;
    refreshRulesList: () => void;
}) => {
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
            "Approval proposed through centralized pull request.",
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
                const update = isUpdateRequest(r);
                return (
                    <Card key={r.uuid}>
                        <Collapsible className="w-full">
                            <CardHeader className="flex flex-row items-center gap-3 px-5 py-4">
                                <Badge active size="xs" className="min-h-auto">
                                    {isMemory(r) ? "Memory" : "Rule"}
                                </Badge>

                                <span className="flex-1 truncate font-medium">
                                    {r.title}
                                </span>

                                <div className="flex items-center gap-3">
                                    <OriginBadge rule={r} />
                                    {!isMemory(r) && (
                                        <IssueSeverityLevelBadge
                                            severity={r.severity}
                                        />
                                    )}
                                    {update && (
                                        <Badge
                                            active
                                            size="xs"
                                            className="min-h-auto">
                                            Update
                                        </Badge>
                                    )}
                                    <CollapsibleTrigger asChild>
                                        <Button
                                            active
                                            size="icon-sm"
                                            variant="helper">
                                            <CollapsibleIndicator />
                                        </Button>
                                    </CollapsibleTrigger>
                                </div>
                            </CardHeader>

                            <CollapsibleContent asChild className="pb-0">
                                <CardContent className="bg-card-lv1 flex flex-col gap-5 pt-4">
                                    <Markdown>{r.rule}</Markdown>

                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button
                                            size="sm"
                                            variant="cancel"
                                            disabled={!canEdit || !r.uuid}
                                            onClick={() => discard(r)}>
                                            Discard
                                        </Button>

                                        {update && (
                                            <Button
                                                size="sm"
                                                variant="helper"
                                                disabled={!canEdit || !r.uuid}
                                                onClick={() =>
                                                    createInstead(r)
                                                }>
                                                Create instead
                                            </Button>
                                        )}

                                        <Button
                                            size="sm"
                                            variant="primary"
                                            disabled={!canEdit || !r.uuid}
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
