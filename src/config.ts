import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NavEnv, NavSettings } from "./nav/types.js";

export const APP_NAME = "nav-szamla-mcp";
export const APP_VERSION = "1.0.0";

export const NAV_ENDPOINTS: Record<NavEnv, string> = {
  test: "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3",
  production: "https://api.onlineszamla.nav.gov.hu/invoiceService/v3",
};

export const CONFIG_DIR = join(homedir(), ".nav-szamla-mcp");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Contents of ~/.nav-szamla-mcp/config.json. Filled in by hand; no tool reads it back or writes it.
 * Everything except the five technical-user fields is optional.
 */
export interface ConfigFile {
  env?: string;
  login?: string;
  password?: string;
  taxNumber?: string;
  signatureKey?: string;
  exchangeKey?: string;
  software?: {
    id?: string;
    name?: string;
    version?: string;
    devName?: string;
    devContact?: string;
    devCountry?: string;
    devTaxNumber?: string;
  };
  timeoutMs?: number;
  baseUrl?: string;
}

/** What a new config.json starts with: test environment, every field to fill in present but empty. */
const BLANK: ConfigFile = {
  env: "test",
  login: "",
  password: "",
  taxNumber: "",
  signatureKey: "",
  exchangeKey: "",
  software: { devName: "", devContact: "" },
};

class SettingsError extends Error {
  constructor(message: string) {
    super(`Configuration (${CONFIG_PATH}): ${message}`);
    this.name = "SettingsError";
  }
}

/** Creates a blank config.json (owner-only, written through a temp file) when there is none yet. */
export function ensureConfigFile(path = CONFIG_PATH): boolean {
  if (existsSync(path)) return false;
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(BLANK, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
  return true;
}

/** Reads config.json, creating a blank one first if it is missing. */
export function readConfigFile(path = CONFIG_PATH): ConfigFile {
  ensureConfigFile(path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    throw new SettingsError(`not valid JSON (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SettingsError("must contain a JSON object.");
  return raw as ConfigFile;
}

const TAX_NUMBER = /^(\d{8})(?:-?\d-?\d{2})?$/;

/**
 * Validates a config into NAV settings. The environment is "test" unless env is "production",
 * because the submit tools create legally binding data reports in production.
 */
export function loadSettings(config: ConfigFile = readConfigFile()): NavSettings {
  const text = (value: unknown, name: string): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new SettingsError(`${name} must be a string.`);
    return value.trim() === "" ? undefined : value.trim();
  };
  const must = (value: unknown, name: string): string => {
    const v = text(value, name);
    if (v === undefined) throw new SettingsError(`${name} is not set.`);
    return v;
  };
  const sw = config.software ?? {};

  const env = (text(config.env, "env") ?? "test").toLowerCase();
  if (env !== "test" && env !== "production") throw new SettingsError(`env must be "test" or "production", not "${env}".`);

  const login = must(config.login, "login");
  if (!/^[a-zA-Z0-9]{6,15}$/.test(login)) throw new SettingsError("login must be 6-15 letters/digits.");

  const taxMatch = must(config.taxNumber, "taxNumber").replace(/\s/g, "").match(TAX_NUMBER);
  if (!taxMatch) throw new SettingsError("taxNumber must be an 8-digit tax ID base number (or 12345678-1-42).");
  const taxNumber = taxMatch[1]!;

  const exchangeKey = must(config.exchangeKey, "exchangeKey");
  if (Buffer.byteLength(exchangeKey) < 16) throw new SettingsError("exchangeKey is shorter than 16 characters.");

  const softwareId = text(sw.id, "software.id") ?? "HU-NAVSZAMLA-MCP01";
  if (!/^[0-9A-Z-]{18}$/.test(softwareId)) throw new SettingsError("software.id must be 18 characters of 0-9, A-Z or '-'.");

  // Everything secret is sent to this URL, so only NAV itself (or a local mock) is allowed.
  const baseUrl = (text(config.baseUrl, "baseUrl") ?? NAV_ENDPOINTS[env]).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new SettingsError(`baseUrl is not a URL: ${baseUrl}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const nav = url.protocol === "https:" && (url.hostname === "nav.gov.hu" || url.hostname.endsWith(".nav.gov.hu"));
  if (!local && !nav) throw new SettingsError(`baseUrl must be an https://*.nav.gov.hu address, not ${url.hostname}.`);

  const timeout = Number(config.timeoutMs ?? 60000);

  return {
    env,
    baseUrl,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60000,
    credentials: {
      login,
      password: must(config.password, "password"),
      taxNumber,
      signatureKey: must(config.signatureKey, "signatureKey"),
      exchangeKey,
    },
    software: {
      id: softwareId,
      name: (text(sw.name, "software.name") ?? APP_NAME).slice(0, 50),
      version: (text(sw.version, "software.version") ?? APP_VERSION).slice(0, 15),
      devName: text(sw.devName, "software.devName") ?? "MrSakal",
      devContact: text(sw.devContact, "software.devContact") ?? "not-set",
      devCountry: text(sw.devCountry, "software.devCountry") ?? "HU",
      devTaxNumber: text(sw.devTaxNumber, "software.devTaxNumber"),
    },
  };
}

/** Config passed in directly (tests); undefined means config.json is read on every tool call. */
export type SettingsSource = ConfigFile | undefined;
