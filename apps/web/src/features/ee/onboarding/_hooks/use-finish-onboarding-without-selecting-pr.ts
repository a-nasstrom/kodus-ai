import { useAsyncAction } from "@hooks/use-async-action";
import { finishOnboarding } from "@services/codeManagement/fetch";
import { useSuspenseGetBYOK } from "@services/organizationParameters/hooks";
import { waitFor } from "src/core/utils/helpers";
import { revalidateServerSideTag } from "src/core/utils/revalidate-server-side";
import { isSelfHosted } from "src/core/utils/self-hosted";

import { startTeamTrial } from "../../subscription/_services/billing/fetch";

export const useFinishOnboardingWithoutSelectingPR = ({
    teamId,
    userId,
    organizationId,
}: {
    teamId: string;
    userId: string;
    organizationId: string;
}) => {
    const byokConfig = useSuspenseGetBYOK();
    const choseBYOK = !!byokConfig?.configValue?.main;

    const [
        finishOnboardingWithoutSelectingPR,
        { loading: isFinishingOnboardingWithoutSelectingPR },
    ] = useAsyncAction(async () => {
        try {
            const result = await finishOnboarding({ teamId, reviewPR: false });
            await revalidateServerSideTag("team-dependent");

            if (!isSelfHosted) {
                await startTeamTrial({
                    teamId,
                    organizationId,
                    byok: choseBYOK,
                });
            }

            await waitFor(5000);

            window.location.href = "/settings/code-review";
        } catch (error) {
            console.error(
                "Error in finishOnboardingWithoutSelectingPR:",
                error,
            );
        }
    });

    return {
        finishOnboardingWithoutSelectingPR,
        isFinishingOnboardingWithoutSelectingPR,
    };
};
