import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SettingsSource } from "../config.js";
import { unpackBase64 } from "../nav/response.js";
import { withNav } from "./respond.js";
import * as t from "../schemas.js";

const writes = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

/** Catches the usual mistakes (wrong encoding, plain text, compressed flag mismatch) before NAV does. */
function checkPayload(data: string, gzip: boolean, label: string): void {
  if (gzip) {
    const magic = Buffer.from(data.slice(0, 4), "base64");
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) throw new Error(`${label}: compressed is true, but the data is not GZIP.`);
    return;
  }
  const start = unpackBase64(data.slice(0, 256), false).replace(/^\uFEFF/, "").trimStart();
  if (!start.startsWith("<")) throw new Error(`${label}: the BASE64 does not contain an XML document.`);
}

export function registerWriteTools(server: McpServer, source: SettingsSource): void {
  server.registerTool(
    "nav_submit_invoices",
    {
      title: "Submit invoices",
      description:
        "Sends invoice data reports to NAV (CREATE, MODIFY, STORNO), up to 100 at once. Each item's data is the " +
        "BASE64 of an InvoiceData XML (invoiceData.xsd); GZIP it first when compressed is true. Indexes must be 1..n. " +
        "The answer only means NAV accepted the batch; check nav_get_transaction_status for the outcome. " +
        "In production this is a legally binding data report.",
      inputSchema: {
        items: z
          .array(
            z.object({
              index: t.itemIndex,
              operation: z.enum(["CREATE", "MODIFY", "STORNO"]),
              data: t.base64.describe("BASE64 InvoiceData XML"),
              electronicInvoiceHash: z.string().regex(/^[0-9A-Fa-f]{64}$|^[0-9A-Fa-f]{128}$/).optional(),
              electronicInvoiceHashAlgorithm: z.enum(["SHA3-512", "SHA-256"]).default("SHA3-512"),
            })
          )
          .min(1)
          .max(100),
        compressed: z.boolean().default(false),
      },
      annotations: writes,
    },
    ({ items, compressed }) =>
      withNav(source, (api) => {
        t.assertConsecutive(items.map((i) => i.index));
        for (const i of items) checkPayload(i.data, compressed, `Item ${i.index}`);
        return api.submitInvoices(
          items.map((i) => ({
            index: i.index,
            operation: i.operation,
            data: i.data,
            electronicInvoiceHash: i.electronicInvoiceHash
              ? { value: i.electronicInvoiceHash.toUpperCase(), algorithm: i.electronicInvoiceHashAlgorithm }
              : undefined,
          })),
          compressed
        );
      })
  );

  server.registerTool(
    "nav_annul_invoices",
    {
      title: "Technical annulment",
      description:
        "Requests technical annulment of earlier data reports. Each item's data is the BASE64 of an InvoiceAnnulment " +
        "XML (invoiceAnnulment.xsd). The taxpayer then has to approve it on the NAV web interface.",
      inputSchema: {
        items: z.array(z.object({ index: t.itemIndex, data: t.base64.describe("BASE64 InvoiceAnnulment XML") })).min(1).max(100),
      },
      annotations: writes,
    },
    ({ items }) =>
      withNav(source, (api) => {
        t.assertConsecutive(items.map((i) => i.index));
        for (const i of items) checkPayload(i.data, false, `Item ${i.index}`);
        return api.annulInvoices(items);
      })
  );
}
