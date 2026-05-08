"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "src/core/providers/auth.provider";
import { axiosAuthorized } from "src/core/utils/axios";
import { createUrl, pathToApiUrl } from "src/core/utils/helpers";

function getHelpdeskUrl() {
    return createUrl(
        process.env.WEB_HOSTNAME_HELPDESK || "localhost",
        process.env.WEB_PORT_HELPDESK || "3004",
        "/auth/cloud",
        { containerName: "kodus-helpdesk-web" },
    );
}

const HELPDESK_TOKEN_URL = pathToApiUrl("/auth/helpdesk-token");

export default function HelpdeskPage() {
    const { accessToken } = useAuth();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [iframeReady, setIframeReady] = useState(false);
    const tokenSentRef = useRef(false);
    const helpdeskUrl = getHelpdeskUrl();
    const helpdeskOrigin = new URL(helpdeskUrl).origin;

    const sendToken = useCallback(async () => {
        if (tokenSentRef.current) return;
        if (!iframeRef.current?.contentWindow || !accessToken) return;

        try {
            const response = await axiosAuthorized.fetcher<{
                data: { token: string };
            }>(HELPDESK_TOKEN_URL);

            iframeRef.current.contentWindow.postMessage(
                { type: "HELPDESK_CLOUD_AUTH", token: response.data.token },
                helpdeskOrigin,
            );
            tokenSentRef.current = true;
        } catch {
            console.error("[helpdesk] Failed to fetch helpdesk token");
        }
    }, [accessToken, helpdeskOrigin]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== helpdeskOrigin) return;

            if (event.data?.type === "HELPDESK_CLOUD_AUTH_READY") {
                setIframeReady(true);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [helpdeskOrigin]);

    // Send token when both iframe is ready and we have a token
    useEffect(() => {
        if (iframeReady && accessToken) {
            sendToken();
        }
    }, [iframeReady, accessToken, sendToken]);

    return (
        <div className="flex-1 overflow-hidden pr-[60px]">
            <iframe
                ref={iframeRef}
                src={helpdeskUrl}
                className="h-full w-full border-0"
                allow="clipboard-write"
                title="Kodus Helpdesk"
            />
        </div>
    );
}
