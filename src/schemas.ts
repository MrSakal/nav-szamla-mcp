import { z } from "zod";

/**
 * Tool input types, constrained to what the NAV v3.0 schemas accept
 * (common.xsd NTCA 1.0, invoiceBase.xsd, invoiceApi.xsd).
 */

const DAY = 86_400_000;
export const MAX_WINDOW_DAYS = 35;

/** TaxpayerIdType [0-9]{8}; the full 12345678-1-42 form is accepted and cut to the 8-digit base number. */
export const taxNumber = z
  .string()
  .transform((s) => s.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{8}(-?\d-?\d{2})?$/, "8-digit tax number or 12345678-1-42"))
  .transform((s) => s.slice(0, 8));

/** InvoiceDateType: YYYY-MM-DD, not before 2010-01-01 */
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), "not a real date")
  .refine((s) => s >= "2010-01-01", "NAV has no data before 2010-01-01");

/** InvoiceTimestampType (UTC, Z). Any ISO 8601 time WITH an offset is accepted and converted. */
export const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/, "ISO 8601 with timezone, e.g. 2026-03-01T00:00:00+01:00")
  .refine((s) => !Number.isNaN(Date.parse(s)), "not a real time")
  .transform((s) => new Date(s).toISOString());

export const direction = z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received invoices, OUTBOUND = issued invoices");
export const invoiceNumber = z.string().trim().min(1).max(50);
export const pageNumber = z.number().int().min(1).default(1).describe("1-based page");
export const itemIndex = z.number().int().min(1).max(100);
export const transactionId = z.string().regex(/^[+a-zA-Z0-9_]{1,30}$/, "NAV transaction ID");
export const operator = z.enum(["EQ", "GT", "GTE", "LT", "LTE"]);
export const docFormat = z.enum(["json", "xml"]).default("json").describe("Embedded XML returned as parsed JSON or as raw XML text");

/** xs:base64Binary as NAV hashes it: no whitespace, standard alphabet, padded */
export const base64 = z
  .string()
  .transform((s) => s.replace(/\s+/g, ""))
  .refine((s) => s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s), "valid padded BASE64");

export const dayConditions = z.array(z.object({ operator, value: day })).max(2);
export const amountConditions = z.array(z.object({ operator, value: z.number() })).max(2);

/** The 35-day (840-hour) limit NAV applies to issue-date and insertion-time windows. */
export function assertWindow(from: string, to: string, what: string): void {
  const a = Date.parse(from.length === 10 ? from + "T00:00:00Z" : from);
  const b = Date.parse(to.length === 10 ? to + "T00:00:00Z" : to);
  if (a > b) throw new Error(`${what}: the start (${from}) is after the end (${to}).`);
  if (b - a > MAX_WINDOW_DAYS * DAY) throw new Error(`${what}: NAV allows at most ${MAX_WINDOW_DAYS} days per query; split the range.`);
}

/** NAV rejects submissions whose indexes are not exactly 1, 2, 3, ... */
export function assertConsecutive(indexes: number[]): void {
  if (indexes.some((value, i) => value !== i + 1)) {
    throw new Error(`Item indexes must run 1..${indexes.length} without gaps, in order (got ${indexes.join(", ")}).`);
  }
}
