import { XMLParser } from "fast-xml-parser";
import { gunzipSync } from "node:zlib";

/**
 * Elements declared with maxOccurs > 1 in the NAV v3.0 schemas. They are always returned as arrays,
 * so a single invoice line or digest item does not change the JSON shape.
 */
const REPEATABLE = new Set([
  // invoiceApi.xsd
  "invoiceDigest", "invoiceChainElement", "transaction", "processingResult", "notification",
  "technicalValidationMessages", "businessValidationMessages", "taxpayerAddressItem",
  "invoiceOperation", "annulmentOperation",
  // invoiceData.xsd / invoiceBase.xsd
  "line", "summaryByVatRate", "summarySimplified", "productCode", "productFeeData", "productFeeSummary",
  "lineProductFeeContent", "additionalInvoiceData", "additionalLineData", "batchInvoice", "newCreatedLines",
  "referenceToOtherLine", "contractNumber", "costCenter", "customerCompanyCode", "supplierCompanyCode",
  "dealerCode", "deliveryNote", "ekaerId", "generalLedgerAccountNumber", "glnNumber", "itemNumber",
  "materialNumber", "orderNumber", "projectNumber", "shippingDate",
]);

/** These names are also used for leaf values (the operation literal), which must stay scalar. */
const REPEATABLE_ONLY_AS_CONTAINER = new Set(["invoiceOperation", "annulmentOperation"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  // keep "01234567" and "0001" as strings
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name, _path, isLeaf) => REPEATABLE.has(name) && !(isLeaf && REPEATABLE_ONLY_AS_CONTAINER.has(name)),
});

export type Json = Record<string, unknown>;

export function parseXml(xml: string): Json {
  return parser.parse(xml) as Json;
}

/** Finds the <...Response> root, or undefined when the body is not a NAV response at all. */
export function responseRoot(doc: Json): { name: string; content: Json } | undefined {
  const name = Object.keys(doc).find((k) => k.endsWith("Response"));
  if (!name) return undefined;
  const content = doc[name];
  return { name, content: content && typeof content === "object" ? (content as Json) : {} };
}

export interface ResultBlock {
  funcCode: string;
  errorCode?: string;
  message?: string;
  notifications?: unknown;
}

/**
 * Most responses carry <result>. GeneralExceptionResponse (common.xsd) extends BasicResultType,
 * so its funcCode/errorCode/message sit directly under the root.
 */
export function resultOf(root: Json): ResultBlock {
  const r = (root.result as Json | undefined) ?? (root.funcCode !== undefined ? root : undefined);
  if (!r) return { funcCode: "ERROR", message: "The NAV response has no result block." };
  return {
    funcCode: String(r.funcCode ?? "ERROR"),
    errorCode: r.errorCode as string | undefined,
    message: r.message as string | undefined,
    notifications: (r.notifications as Json | undefined)?.notification,
  };
}

/** Root content without the parts that only echo the request. */
export function payloadOf(root: Json): Json {
  const { header: _h, software: _s, result: _r, ...rest } = root;
  return rest;
}

export const asBool = (v: unknown): boolean => v === true || v === "true";

/** NAV accepts at most 15 MB uncompressed per invoice; refuse to inflate anything much bigger. */
const INFLATE_LIMIT = 32 * 1024 * 1024;

/** BASE64 (GZIP-compressed when `gzip`) -> text */
export function unpackBase64(data: string, gzip: boolean): string {
  const bytes = Buffer.from(data.replace(/\s+/g, ""), "base64");
  return (gzip ? gunzipSync(bytes, { maxOutputLength: INFLATE_LIMIT }) : bytes).toString("utf8");
}

/** Embedded InvoiceData / original request as parsed JSON (default) or XML text. */
export function unpackDocument(data: string, gzip: boolean, as: "json" | "xml"): unknown {
  const xml = unpackBase64(data, gzip);
  return as === "xml" ? xml : parseXml(xml);
}
