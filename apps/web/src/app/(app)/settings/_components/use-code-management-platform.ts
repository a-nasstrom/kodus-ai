import { useSuspenseGetConnections } from "@services/setup/hooks";
import { useSelectedTeamId } from "src/core/providers/selected-team-context";
import { PlatformType } from "src/core/types";
import { safeArray } from "src/core/utils/safe-array";

/**
 * Returns the platform type(s) of the active CODE_MANAGEMENT connections
 * for the current team. Returns a Set for O(1) lookups.
 */
function useCodeManagementPlatforms(): Set<string> {
    const { teamId } = useSelectedTeamId();
    const connections = useSuspenseGetConnections(teamId);

    return new Set(
        safeArray(connections)
            .filter(
                (c) => c.category === "CODE_MANAGEMENT" && c.hasConnection,
            )
            .map((c) => c.platformName),
    );
}

/** True when the team has at least one GitHub code-management connection. */
export function useIsGithub(): boolean {
    return useCodeManagementPlatforms().has(PlatformType.GITHUB);
}

/** True when the team has at least one GitLab code-management connection. */
export function useIsGitlab(): boolean {
    return useCodeManagementPlatforms().has(PlatformType.GITLAB);
}

/** True when the team has at least one Bitbucket code-management connection. */
export function useIsBitbucket(): boolean {
    return useCodeManagementPlatforms().has(PlatformType.BITBUCKET);
}
