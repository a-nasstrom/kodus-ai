"use client";

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleIndicator,
    CollapsibleTrigger,
} from "@components/ui/collapsible";
import { FormControl } from "@components/ui/form-control";
import { Input } from "@components/ui/input";
import { Separator } from "@components/ui/separator";
import { Textarea } from "@components/ui/textarea";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { BrainCircuitIcon, Settings2Icon } from "lucide-react";
import { Controller, useFormContext } from "react-hook-form";

import type { EditKeyForm } from "../_types";

const THINKING_OPTIONS = [
    { value: "none", label: "Off" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "custom", label: "Custom" },
] as const;

const NumberField = ({
    name,
    label,
    placeholder,
    helper,
}: {
    name: keyof EditKeyForm;
    label: string;
    placeholder: string;
    helper: string;
}) => {
    const { control } = useFormContext<EditKeyForm>();

    return (
        <Controller
            name={name}
            control={control}
            render={({ field, fieldState }) => (
                <FormControl.Root>
                    <FormControl.Label htmlFor={name}>{label}</FormControl.Label>
                    <FormControl.Input>
                        <Input
                            id={name}
                            type="number"
                            min={0}
                            step={name === "temperature" ? 0.1 : 1}
                            max={name === "temperature" ? 2 : undefined}
                            placeholder={placeholder}
                            error={fieldState.error}
                            value={field.value != null ? field.value : ""}
                            onChange={(e) => {
                                const val = e.target.value;
                                const num =
                                    name === "temperature"
                                        ? parseFloat(val)
                                        : parseInt(val, 10);
                                field.onChange(
                                    val === "" || Number.isNaN(num)
                                        ? null
                                        : num,
                                );
                            }}
                        />
                    </FormControl.Input>
                    <FormControl.Helper>{helper}</FormControl.Helper>
                    <FormControl.Error>
                        {fieldState.error?.message}
                    </FormControl.Error>
                </FormControl.Root>
            )}
        />
    );
};

export const ByokAdvancedSettings = () => {
    const { control, watch } = useFormContext<EditKeyForm>();
    const currentEffort = watch("reasoningEffort");
    const isCustom = currentEffort === ("custom" as string);

    return (
        <Collapsible className="border-card-lv2 rounded-lg border">
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="text-text-secondary hover:text-text-primary hover:bg-card-lv2/40 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors data-[state=open]:rounded-b-none">
                    <span className="flex items-center gap-2">
                        <Settings2Icon className="size-4" />
                        Advanced settings
                    </span>
                    <CollapsibleIndicator />
                </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
                <div className="border-card-lv2 flex flex-col gap-5 border-t px-3 pt-4">
                    {/* ── Thinking / Reasoning ──────────────── */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                            <BrainCircuitIcon className="text-text-secondary size-4" />
                            <span className="text-text-primary text-sm font-medium">
                                Thinking / Reasoning
                            </span>
                        </div>

                        <Controller
                            name="reasoningEffort"
                            control={control}
                            render={({ field }) => (
                                <ToggleGroup.Root
                                    type="single"
                                    className="bg-card-lv2 grid grid-cols-5 gap-px overflow-hidden rounded-lg p-0.5"
                                    value={
                                        field.value ??
                                        (watch("reasoningConfigOverride")
                                            ? "custom"
                                            : "none")
                                    }
                                    onValueChange={(value) => {
                                        if (!value) return;
                                        field.onChange(
                                            value === "none" ? null : value,
                                        );
                                    }}>
                                    {THINKING_OPTIONS.map((opt) => (
                                        <ToggleGroup.Item
                                            key={opt.value}
                                            value={opt.value}
                                            className="text-text-secondary hover:text-text-primary data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:ring-primary/40 data-[state=on]:shadow-sm rounded-md px-2 py-1.5 text-xs font-medium transition-colors data-[state=on]:ring-1">
                                            {opt.label}
                                        </ToggleGroup.Item>
                                    ))}
                                </ToggleGroup.Root>
                            )}
                        />

                        {isCustom && (
                            <Controller
                                name="reasoningConfigOverride"
                                control={control}
                                render={({ field, fieldState }) => (
                                    <FormControl.Root>
                                        <FormControl.Input>
                                            <Textarea
                                                className="font-mono text-xs leading-relaxed"
                                                rows={3}
                                                placeholder={`{\n  "budget_tokens": 25000\n}`}
                                                value={field.value ?? ""}
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value || null,
                                                    )
                                                }
                                            />
                                        </FormControl.Input>
                                        <FormControl.Helper>
                                            Provider-specific JSON. Passed
                                            directly as reasoning config.
                                        </FormControl.Helper>
                                        <FormControl.Error>
                                            {fieldState.error?.message}
                                        </FormControl.Error>
                                    </FormControl.Root>
                                )}
                            />
                        )}

                        {!isCustom && currentEffort && currentEffort !== "none" && (
                            <p className="text-text-tertiary text-xs">
                                Mapped automatically to your provider (Claude
                                extended thinking, Gemini thinking level, OpenAI
                                reasoning effort).
                            </p>
                        )}
                    </div>

                    <Separator className="bg-card-lv2" />

                    {/* ── Model Parameters ──────────────────── */}
                    <div className="grid grid-cols-2 gap-4">
                        <NumberField
                            name="temperature"
                            label="Temperature"
                            placeholder="Default"
                            helper="0 = deterministic, 2 = creative"
                        />
                        <NumberField
                            name="maxOutputTokens"
                            label="Max output tokens"
                            placeholder="Default"
                            helper="Empty uses model default"
                        />
                    </div>

                    <Separator className="bg-card-lv2" />

                    {/* ── Limits ────────────────────────────── */}
                    <div className="grid grid-cols-2 gap-4">
                        <NumberField
                            name="maxInputTokens"
                            label="Max input tokens"
                            placeholder="No limit"
                            helper="Context window cap"
                        />
                        <NumberField
                            name="maxConcurrentRequests"
                            label="Max concurrent requests"
                            placeholder="No limit"
                            helper="For rate-limited providers"
                        />
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
};
