import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const ask = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "monthly-invoices",
    {
      title: "Monthly invoices",
      description: "Every received or issued invoice of one month, with totals",
      argsSchema: {
        month: z.string().describe("Month, YYYY-MM"),
        direction: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued"),
      },
    },
    ({ month, direction }) =>
      ask(
        `Collect every ${direction === "INBOUND" ? "received" : "issued"} invoice of ${month} with the nav_search_invoices ` +
          `tool (issuedFrom = first day of the month, issuedTo = last day; fetch every page). ` +
          `Table: invoice number, issue date, partner name and tax number, net amount, VAT, currency. ` +
          `Finish with net and VAT totals per currency, and point out modifying and storno invoices.`
      )
  );

  server.registerPrompt(
    "check-partner",
    {
      title: "Check a partner",
      description: "Checks a business partner in NAV before invoicing",
      argsSchema: { taxNumber: z.string().describe("The partner's tax number") },
    },
    ({ taxNumber }) =>
      ask(
        `Check the partner with tax number ${taxNumber} using the nav_get_taxpayer tool. Summarise briefly: is the tax ` +
          `number valid, what are the registered name and seat, is it a member of a VAT group, and is there anything that ` +
          `speaks against issuing an invoice to it.`
      )
  );

  server.registerPrompt(
    "explain-transaction",
    {
      title: "Explain a submission result",
      description: "Explains the processing result of a submission in plain language",
      argsSchema: { transactionId: z.string().describe("Transaction ID") },
    },
    ({ transactionId }) =>
      ask(
        `Get the status of transaction ${transactionId} with the nav_get_transaction_status tool. For each item, say ` +
          `whether NAV accepted it, and for every error or warning message explain what has to be fixed.`
      )
  );
}
