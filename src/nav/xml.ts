import type { NavSettings } from "./types.js";
import { newRequestId, passwordHash, requestSignature } from "./auth.js";

export const API_NAMESPACE = "http://schemas.nav.gov.hu/OSA/3.0/api";
export const COMMON_NAMESPACE = "http://schemas.nav.gov.hu/NTCA/1.0/common";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ENTITIES[ch]!);
}

type Scalar = string | number | boolean;

/** <name attr="...">value</name>, or nothing when the value is absent. */
export function leaf(name: string, value: Scalar | undefined | null, attrs?: Record<string, string>): string {
  if (value === undefined || value === null || value === "") return "";
  const a = attrs ? Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeText(v)}"`).join("") : "";
  return `<${name}${a}>${escapeText(String(value))}</${name}>`;
}

/** Container element with pre-rendered children. */
export function node(name: string, ...children: string[]): string {
  return `<${name}>${children.join("")}</${name}>`;
}

/** Container element that is left out entirely when it would be empty. */
export function optionalNode(name: string, ...children: string[]): string {
  const inner = children.join("");
  return inner ? `<${name}>${inner}</${name}>` : "";
}

export interface Envelope {
  xml: string;
  requestId: string;
  timestamp: string;
}

/**
 * Wraps an operation body into <XxxRequest> with the common header, user and software blocks,
 * in the order BasicRequestType (common.xsd) + BasicOnlineInvoiceRequestType (invoiceApi.xsd) demand.
 */
export function envelope(
  operation: string,
  settings: NavSettings,
  body: string,
  options: { indexHashes?: readonly string[]; now?: Date; requestId?: string } = {}
): Envelope {
  const requestId = options.requestId ?? newRequestId();
  const timestamp = (options.now ?? new Date()).toISOString();
  const { credentials: c, software: s } = settings;
  const root = operation.charAt(0).toUpperCase() + operation.slice(1) + "Request";

  const header = node(
    "common:header",
    leaf("common:requestId", requestId),
    leaf("common:timestamp", timestamp),
    leaf("common:requestVersion", "3.0"),
    leaf("common:headerVersion", "1.0")
  );
  const user = node(
    "common:user",
    leaf("common:login", c.login),
    leaf("common:passwordHash", passwordHash(c.password), { cryptoType: "SHA-512" }),
    leaf("common:taxNumber", c.taxNumber),
    leaf(
      "common:requestSignature",
      requestSignature({ requestId, timestamp, signatureKey: c.signatureKey, indexHashes: options.indexHashes }),
      { cryptoType: "SHA3-512" }
    )
  );
  const software = node(
    "software",
    leaf("softwareId", s.id),
    leaf("softwareName", s.name),
    leaf("softwareOperation", "LOCAL_SOFTWARE"),
    leaf("softwareMainVersion", s.version),
    leaf("softwareDevName", s.devName),
    leaf("softwareDevContact", s.devContact),
    leaf("softwareDevCountryCode", s.devCountry),
    leaf("softwareDevTaxNumber", s.devTaxNumber)
  );

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<${root} xmlns="${API_NAMESPACE}" xmlns:common="${COMMON_NAMESPACE}">` +
    header + user + software + body +
    `</${root}>`;
  return { xml, requestId, timestamp };
}
