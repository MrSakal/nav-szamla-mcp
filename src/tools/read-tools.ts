import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InvoiceSearch } from "../nav/types.js";
import type { SettingsSource } from "../config.js";
import { withNav } from "./respond.js";
import * as t from "../schemas.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

export function registerReadTools(server: McpServer, source: SettingsSource): void {
  server.registerTool(
    "nav_get_taxpayer",
    {
      title: "Get taxpayer",
      description: "Looks up a Hungarian taxpayer in NAV: validity, name, addresses, incorporation, VAT group.",
      inputSchema: { taxNumber: t.taxNumber.describe("Tax number (8 digits or 12345678-1-42)") },
      annotations: readOnly,
    },
    ({ taxNumber }) => withNav(source, (api) => api.taxpayer(taxNumber))
  );

  server.registerTool(
    "nav_get_invoice",
    {
      title: "Get invoice",
      description:
        "Returns one invoice with its full content. NAV sends the invoice as BASE64 (sometimes GZIP); it is unpacked here.",
      inputSchema: {
        invoiceNumber: t.invoiceNumber,
        direction: t.direction,
        supplierTaxNumber: t.taxNumber.optional().describe("Supplier tax number, for INBOUND invoices"),
        batchIndex: z.number().int().min(1).optional().describe("Position inside a batch modification"),
        format: t.docFormat,
      },
      annotations: readOnly,
    },
    (a) =>
      withNav(source, (api) =>
        api.invoice(
          { invoiceNumber: a.invoiceNumber, direction: a.direction, supplierTaxNumber: a.supplierTaxNumber, batchIndex: a.batchIndex },
          a.format
        )
      )
  );

  server.registerTool(
    "nav_invoice_exists",
    {
      title: "Invoice exists",
      description: "Tells whether NAV has a data report for the given invoice number (invoiceCheckResult).",
      inputSchema: {
        invoiceNumber: t.invoiceNumber,
        direction: t.direction,
        supplierTaxNumber: t.taxNumber.optional(),
        batchIndex: z.number().int().min(1).optional(),
      },
      annotations: readOnly,
    },
    (a) => withNav(source, (api) => api.invoiceExists({ ...a }))
  );

  server.registerTool(
    "nav_search_invoices",
    {
      title: "Search invoices",
      description:
        "Lists invoice summaries, 100 per page. Give exactly one time frame: issuedFrom+issuedTo (issue date), " +
        "insertedFrom+insertedTo (when NAV received it), or originalInvoiceNumber (its modifications). " +
        "Time frames are limited to 35 days by NAV. Range filters take one or two conditions (e.g. GTE and LTE).",
      inputSchema: {
        direction: t.direction,
        page: t.pageNumber,
        issuedFrom: t.day.optional(),
        issuedTo: t.day.optional(),
        insertedFrom: t.instant.optional(),
        insertedTo: t.instant.optional(),
        originalInvoiceNumber: t.invoiceNumber.optional(),
        partnerTaxNumber: t.taxNumber.optional(),
        partnerGroupMemberTaxNumber: t.taxNumber.optional(),
        partnerName: z.string().trim().min(5).max(512).optional().describe("Beginning of the partner name, min. 5 characters"),
        invoiceCategory: z.enum(["NORMAL", "SIMPLIFIED", "AGGREGATE"]).optional(),
        paymentMethod: z.enum(["TRANSFER", "CASH", "CARD", "VOUCHER", "OTHER"]).optional(),
        invoiceAppearance: z.enum(["PAPER", "ELECTRONIC", "EDI", "UNKNOWN"]).optional(),
        source: z.enum(["WEB", "XML", "MGM", "OPG", "OSZ"]).optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional().describe("ISO 4217, e.g. HUF"),
        deliveryDate: t.dayConditions.optional().describe("Delivery (supply) date"),
        paymentDue: t.dayConditions.optional().describe("Payment due date"),
        netAmount: t.amountConditions.optional(),
        netAmountHUF: t.amountConditions.optional(),
        vatAmount: t.amountConditions.optional(),
        vatAmountHUF: t.amountConditions.optional(),
        transactionId: t.transactionId.optional(),
        transactionIndex: t.itemIndex.optional(),
        transactionOperation: z.enum(["CREATE", "MODIFY", "STORNO"]).optional(),
      },
      annotations: readOnly,
    },
    (a) =>
      withNav(source, (api) => {
        const issued = a.issuedFrom !== undefined || a.issuedTo !== undefined;
        const inserted = a.insertedFrom !== undefined || a.insertedTo !== undefined;
        const original = a.originalInvoiceNumber !== undefined;
        if (Number(issued) + Number(inserted) + Number(original) !== 1) {
          throw new Error("Use exactly one time frame: issuedFrom+issuedTo, insertedFrom+insertedTo, or originalInvoiceNumber.");
        }

        let window: InvoiceSearch["window"];
        if (issued) {
          if (!a.issuedFrom || !a.issuedTo) throw new Error("issuedFrom and issuedTo belong together.");
          t.assertWindow(a.issuedFrom, a.issuedTo, "Issue date");
          window = { kind: "issueDate", from: a.issuedFrom, to: a.issuedTo };
        } else if (inserted) {
          if (!a.insertedFrom || !a.insertedTo) throw new Error("insertedFrom and insertedTo belong together.");
          t.assertWindow(a.insertedFrom, a.insertedTo, "Insertion time");
          window = { kind: "insertedAt", from: a.insertedFrom, to: a.insertedTo };
        } else {
          window = { kind: "originalInvoice", invoiceNumber: a.originalInvoiceNumber! };
        }

        if (!a.transactionId && (a.transactionIndex !== undefined || a.transactionOperation !== undefined)) {
          throw new Error("transactionIndex and transactionOperation need a transactionId.");
        }

        return api.searchInvoices({
          page: a.page,
          direction: a.direction,
          window,
          partner: { taxNumber: a.partnerTaxNumber, groupMemberTaxNumber: a.partnerGroupMemberTaxNumber, name: a.partnerName },
          invoiceCategory: a.invoiceCategory,
          paymentMethod: a.paymentMethod,
          invoiceAppearance: a.invoiceAppearance,
          source: a.source,
          currency: a.currency,
          ranges: {
            invoiceDelivery: a.deliveryDate,
            paymentDate: a.paymentDue,
            invoiceNetAmount: a.netAmount,
            invoiceNetAmountHUF: a.netAmountHUF,
            invoiceVatAmount: a.vatAmount,
            invoiceVatAmountHUF: a.vatAmountHUF,
          },
          transaction: a.transactionId
            ? { id: a.transactionId, index: a.transactionIndex, operation: a.transactionOperation }
            : undefined,
        });
      })
  );

  server.registerTool(
    "nav_get_invoice_chain",
    {
      title: "Invoice modification chain",
      description: "Shows an invoice together with every modification and storno that references it.",
      inputSchema: {
        invoiceNumber: t.invoiceNumber.describe("The original invoice number"),
        direction: t.direction,
        partnerTaxNumber: t.taxNumber.optional(),
        page: t.pageNumber,
      },
      annotations: readOnly,
    },
    (a) => withNav(source, (api) => api.invoiceChain(a.page, a.invoiceNumber, a.direction, a.partnerTaxNumber))
  );

  server.registerTool(
    "nav_get_transaction_status",
    {
      title: "Submission status",
      description:
        "Processing result of a submission (nav_submit_invoices / nav_annul_invoices): status per item and every " +
        "technical or business validation message. includeOriginal also returns what was sent, unpacked.",
      inputSchema: {
        transactionId: t.transactionId,
        includeOriginal: z.boolean().default(false),
        format: t.docFormat,
      },
      annotations: readOnly,
    },
    (a) => withNav(source, (api) => api.transactionStatus(a.transactionId, a.includeOriginal, a.format))
  );

  server.registerTool(
    "nav_list_transactions",
    {
      title: "List submissions",
      description:
        "Submissions NAV received in a time frame of at most 35 days. Use it to find a transaction ID " +
        "when a submission timed out, before sending anything again.",
      inputSchema: {
        from: t.instant,
        to: t.instant,
        status: z.enum(["RECEIVED", "PROCESSING", "SAVED", "FINISHED", "NOTIFIED"]).optional(),
        page: t.pageNumber,
      },
      annotations: readOnly,
    },
    (a) =>
      withNav(source, (api) => {
        t.assertWindow(a.from, a.to, "Time frame");
        return api.transactions(a.page, a.from, a.to, a.status);
      })
  );
}
