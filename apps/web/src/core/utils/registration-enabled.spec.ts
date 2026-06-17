import { isRegistrationEnabled } from "./registration-enabled";

describe("isRegistrationEnabled", () => {
    const ORIG = process.env.WEB_REGISTRATION_ENABLED;

    afterEach(() => {
        if (ORIG === undefined) {
            delete process.env.WEB_REGISTRATION_ENABLED;
        } else {
            process.env.WEB_REGISTRATION_ENABLED = ORIG;
        }
    });

    it("returns true when WEB_REGISTRATION_ENABLED is unset", () => {
        delete process.env.WEB_REGISTRATION_ENABLED;
        expect(isRegistrationEnabled()).toBe(true);
    });

    it("returns true when WEB_REGISTRATION_ENABLED is true", () => {
        process.env.WEB_REGISTRATION_ENABLED = "true";
        expect(isRegistrationEnabled()).toBe(true);
    });

    it("returns true when WEB_REGISTRATION_ENABLED is TRUE (case-insensitive)", () => {
        process.env.WEB_REGISTRATION_ENABLED = "TRUE";
        expect(isRegistrationEnabled()).toBe(true);
    });

    it("returns false when WEB_REGISTRATION_ENABLED is false", () => {
        process.env.WEB_REGISTRATION_ENABLED = "false";
        expect(isRegistrationEnabled()).toBe(false);
    });
});
