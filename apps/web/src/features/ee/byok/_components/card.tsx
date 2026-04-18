import { Button } from "@components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@components/ui/card";
import { FormControl } from "@components/ui/form-control";
import { magicModal } from "@components/ui/magic-modal";
import { Separator } from "@components/ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@components/ui/tooltip";
import { HelpCircleIcon, PencilIcon, PlusIcon } from "lucide-react";

import type { BYOKConfig } from "../_types";
import { BYOKEditKeyModal } from "./_modals/edit-key";

export const BYOKCard = ({
    type,
    config,
    onSave,
    onDelete,
    tooltip,
}: {
    type: "main" | "fallback";
    config: BYOKConfig | undefined;
    onSave: (_: BYOKConfig) => Promise<void>;
    onDelete: () => Promise<void>;
    tooltip: React.JSX.Element;
}) => {
    return (
        <Card color="lv1" className="min-h-40 flex-1">
            <CardHeader className="flex-row justify-between">
                <div className="flex items-center">
                    <CardTitle className="capitalize">
                        {type}{" "}
                        {type === "fallback" && (
                            <small className="text-text-tertiary font-normal lowercase">
                                (optional)
                            </small>
                        )}
                    </CardTitle>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="cancel"
                                size="icon-xs"
                                className="text-primary-light">
                                <HelpCircleIcon />
                            </Button>
                        </TooltipTrigger>

                        <TooltipContent>{tooltip}</TooltipContent>
                    </Tooltip>
                </div>

                <Button
                    size="xs"
                    variant="primary-dark"
                    leftIcon={!config ? <PlusIcon /> : <PencilIcon />}
                    onClick={() =>
                        magicModal.show(() => (
                            <BYOKEditKeyModal
                                type={type}
                                config={config}
                                onSave={onSave}
                                onDelete={onDelete}
                            />
                        ))
                    }>
                    {!config ? "Add" : "Edit"}
                </Button>
            </CardHeader>

            <CardContent>
                {!config ? <ConfigNotSet /> : <ConfigTable config={config} />}
            </CardContent>
        </Card>
    );
};

const ConfigNotSet = () => (
    <div className="flex h-full items-center justify-center pb-4">
        <span className="text-text-secondary self-center text-center text-sm">
            Key not set
        </span>
    </div>
);

const ConfigRow = ({
    label,
    value,
}: {
    label: string;
    value: React.ReactNode;
}) => (
    <>
        <Separator className="bg-card-lv2 my-2" />
        <FormControl.Root className="flex flex-row justify-between">
            <FormControl.Label>{label}</FormControl.Label>
            <FormControl.Input>
                <span className="text-text-secondary text-sm">{value}</span>
            </FormControl.Input>
        </FormControl.Root>
    </>
);

const ConfigTable = ({ config }: { config: BYOKConfig }) => {
    const thinkingLabel =
        config.reasoningEffort && config.reasoningEffort !== "none"
            ? config.reasoningConfigOverride
                ? "Custom"
                : config.reasoningEffort.charAt(0).toUpperCase() +
                  config.reasoningEffort.slice(1)
            : null;

    return (
        <>
            <FormControl.Root className="flex flex-row justify-between">
                <FormControl.Label>Provider</FormControl.Label>
                <FormControl.Input>
                    <span className="text-text-secondary text-sm">
                        {config.provider}
                    </span>
                </FormControl.Input>
            </FormControl.Root>

            <ConfigRow label="Model" value={config.model} />
            <ConfigRow label="Key" value={config.apiKey} />

            {config.baseURL && (
                <ConfigRow label="Base URL" value={config.baseURL} />
            )}

            {thinkingLabel && (
                <ConfigRow label="Thinking" value={thinkingLabel} />
            )}

            {config.temperature != null && (
                <ConfigRow label="Temperature" value={config.temperature} />
            )}

            {config.maxOutputTokens != null &&
                config.maxOutputTokens > 0 && (
                    <ConfigRow
                        label="Max output tokens"
                        value={config.maxOutputTokens}
                    />
                )}

            {config.maxInputTokens != null && config.maxInputTokens > 0 && (
                <ConfigRow
                    label="Max input tokens"
                    value={config.maxInputTokens}
                />
            )}

            {config.maxConcurrentRequests != null &&
                config.maxConcurrentRequests > 0 && (
                    <ConfigRow
                        label="Max concurrent requests"
                        value={config.maxConcurrentRequests}
                    />
                )}
        </>
    );
};
