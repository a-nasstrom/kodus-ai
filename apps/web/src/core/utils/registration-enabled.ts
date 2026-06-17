export function isRegistrationEnabled(): boolean {
    return (
        (process.env.WEB_REGISTRATION_ENABLED ?? "true").toLowerCase() ===
        "true"
    );
}
