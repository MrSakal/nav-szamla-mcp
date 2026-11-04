import type { ConfigFile } from "../src/config.js";

/** Fake technical user used by every test (signature key from NAV spec 1.5.1's example). */
export const SETTINGS_SOURCE = {
  env: "test",
  login: "testuser01",
  password: "password",
  taxNumber: "01234567",
  signatureKey: "ce-8f5e-215119fa7dd621DLMRHRLH2S",
  exchangeKey: "0123456789abcdef",
} satisfies ConfigFile;
