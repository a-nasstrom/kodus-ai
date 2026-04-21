"use client";

import {
    Alert,
    AlertDescription,
    AlertTitle,
} from "@components/ui/alert";
import { magicModal } from "@components/ui/magic-modal";
import { Page } from "@components/ui/page";
import { toast } from "@components/ui/toaster/use-toast";
import {
    createOrUpdateOrganizationParameter,
    deleteBYOK,
    type LLMConfigStatus,
} from "@services/organizationParameters/fetch";
import { OrganizationParametersConfigKey } from "@services/parameters/types";
import { InfoIcon } from "lucide-react";
import { ConfirmModal } from "src/core/components/ui/confirm-modal";
import { revalidateServerSidePath } from "src/core/utils/revalidate-server-side";

import type { BYOKConfig } from "../_types";
import { BYOKCard } from "./card";

const providerLabel = (providerId?: string) => {
    switch (providerId) {
        case "openai":
            return "OpenAI";
        case "openai_compatible":
            return "OpenAI-compatible";
        case "anthropic":
            return "Anthropic";
        case "google_gemini":
            return "Google AI Studio (Gemini)";
        case "google_vertex":
            return "Google Vertex AI";
        default:
            return providerId ?? "Unknown";
    }
};

const EnvDataValue = ({ children }: { children: React.ReactNode }) => (
    <code className="bg-card-lv2 rounded px-1.5 py-0.5 font-mono text-xs break-all">
        {children}
    </code>
);

const EnvConfigNotice = ({ env }: { env: LLMConfigStatus["env"] }) => {
    if (!env.configured) return null;

    return (
        <Alert variant="info">
            <InfoIcon />
            <AlertTitle className="text-balance">
                Kodus is currently using an LLM configured via environment
                variables.
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
                <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5">
                    {env.model && (
                        <>
                            <dt className="text-text-secondary">Model</dt>
                            <dd>
                                <EnvDataValue>{env.model}</EnvDataValue>
                            </dd>
                        </>
                    )}

                    <dt className="text-text-secondary">Provider</dt>
                    <dd className="text-text-primary">
                        {providerLabel(env.providerId)}
                    </dd>

                    {env.baseUrl && (
                        <>
                            <dt className="text-text-secondary">Endpoint</dt>
                            <dd>
                                <EnvDataValue>{env.baseUrl}</EnvDataValue>
                            </dd>
                        </>
                    )}

                    {env.vertexLocation && (
                        <>
                            <dt className="text-text-secondary">
                                Vertex location
                            </dt>
                            <dd>
                                <EnvDataValue>{env.vertexLocation}</EnvDataValue>
                            </dd>
                        </>
                    )}
                </dl>

                <p className="text-pretty">
                    The API key is not shown for security. Filling in the form
                    below and saving will{" "}
                    <strong className="text-text-primary font-semibold">
                        override
                    </strong>{" "}
                    this env-based configuration — clear the form to go back to
                    env.
                </p>
            </AlertDescription>
        </Alert>
    );
};

const confirmEnvOverride = (): Promise<boolean> => {
    return new Promise((resolve) => {
        magicModal.show(() => (
            <ConfirmModal
                open
                title="Override env-based LLM configuration?"
                description="This will replace the LLM provider currently configured in your .env. Kodus will use the key and model you just entered instead."
                confirmText="Override env config"
                variant="primary-dark"
                onConfirm={() => {
                    resolve(true);
                    magicModal.hide();
                }}
                onCancel={() => {
                    resolve(false);
                    magicModal.hide();
                }}
            />
        ));
    });
};

export const ByokPageClient = ({
    config,
    llmConfigStatus,
}: {
    config: { main: BYOKConfig; fallback: BYOKConfig } | null;
    llmConfigStatus: LLMConfigStatus | null;
}) => {
    const envIsActiveSource = llmConfigStatus?.source === "env";

    const onSaveMain = async (newConfig: BYOKConfig) => {
        // Only warn when saving the main slot while env is the active source
        // — fallback never overrides env on its own, and a re-save on an
        // already-BYOK install is a normal edit.
        if (envIsActiveSource) {
            const proceed = await confirmEnvOverride();
            if (!proceed) return;
        }

        try {
            await createOrUpdateOrganizationParameter(
                OrganizationParametersConfigKey.BYOK_CONFIG,
                {
                    main: newConfig,
                },
            );

            toast({
                variant: "success",
                title: "Main key saved",
            });

            await revalidateServerSidePath("/organization/byok");
        } catch {
            toast({
                variant: "danger",
                title: "Main key couldn't be saved",
            });
        }
    };

    const onSaveFallback = async (newConfig: BYOKConfig) => {
        try {
            await createOrUpdateOrganizationParameter(
                OrganizationParametersConfigKey.BYOK_CONFIG,
                {
                    fallback: newConfig,
                },
            );

            toast({
                variant: "success",
                title: "Fallback key saved",
            });

            await revalidateServerSidePath("/organization/byok");
        } catch {
            toast({
                variant: "danger",
                title: "Fallback key couldn't be saved",
                description:
                    "If you're trying to add Fallback key before Main one, it will not work.",
            });
        }
    };

    const onDeleteMain = async () => {
        try {
            await deleteBYOK({ configType: "main" });

            toast({
                variant: "success",
                title: "Main key deleted",
            });

            await revalidateServerSidePath("/organization/byok");
        } catch {
            toast({
                variant: "danger",
                title: "Main key couldn't be deleted",
            });
        }
    };

    const onDeleteFallback = async () => {
        try {
            await deleteBYOK({ configType: "fallback" });

            toast({
                variant: "success",
                title: "Fallback key deleted",
            });

            await revalidateServerSidePath("/organization/byok");
        } catch {
            toast({
                variant: "danger",
                title: "Fallback key couldn't be deleted",
            });
        }
    };

    const showEnvNotice =
        !!llmConfigStatus?.env.configured && !config?.main;

    return (
        <Page.Root>
            <Page.Header>
                <Page.TitleContainer>
                    <Page.Title>Bring your own key</Page.Title>
                </Page.TitleContainer>
            </Page.Header>

            <Page.Content>
                {showEnvNotice && llmConfigStatus && (
                    <EnvConfigNotice env={llmConfigStatus.env} />
                )}

                <div className="flex gap-4">
                    <BYOKCard
                        type="main"
                        config={config?.main}
                        onSave={onSaveMain}
                        onDelete={onDeleteMain}
                        tooltip={
                            <div>
                                <p>This key will be the first to be used.</p>
                            </div>
                        }
                    />
                    <BYOKCard
                        type="fallback"
                        config={config?.fallback}
                        onSave={onSaveFallback}
                        onDelete={onDeleteFallback}
                        tooltip={
                            <p>
                                Optional. This key will be used if Main key
                                fails.
                            </p>
                        }
                    />
                </div>
            </Page.Content>
        </Page.Root>
    );
};
