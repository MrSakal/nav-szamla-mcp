import type { AnnulmentSubmission, Condition, InvoiceRef, InvoiceSearch, InvoiceSubmission } from "./types.js";
import { leaf, node, optionalNode } from "./xml.js";

/**
 * Request bodies (everything after <software>) for each invoiceService operation.
 * Element order mirrors the xs:sequence definitions in invoiceApi.xsd v3.0.
 */

const invoiceNumberQuery = (ref: InvoiceRef): string =>
  node(
    "invoiceNumberQuery",
    leaf("invoiceNumber", ref.invoiceNumber),
    leaf("invoiceDirection", ref.direction),
    leaf("batchIndex", ref.batchIndex),
    leaf("supplierTaxNumber", ref.supplierTaxNumber)
  );

const conditions = <V extends string | number>(name: string, list?: Condition<V>[]): string =>
  (list ?? []).map((c) => node(name, leaf("queryOperator", c.operator), leaf("queryValue", c.value))).join("");

function mandatoryParams(window: InvoiceSearch["window"]): string {
  switch (window.kind) {
    case "issueDate":
      return node("invoiceIssueDate", leaf("dateFrom", window.from), leaf("dateTo", window.to));
    case "insertedAt":
      return node("insDate", leaf("dateTimeFrom", window.from), leaf("dateTimeTo", window.to));
    case "originalInvoice":
      return leaf("originalInvoiceNumber", window.invoiceNumber);
  }
}

export const body = {
  tokenExchange: (): string => "",

  queryTaxpayer: (taxNumber: string): string => leaf("taxNumber", taxNumber),

  queryInvoiceData: invoiceNumberQuery,

  /** QueryInvoiceCheckRequest reuses QueryInvoiceDataRequestType. */
  queryInvoiceCheck: invoiceNumberQuery,

  queryInvoiceDigest(s: InvoiceSearch): string {
    const r = s.ranges ?? {};
    const additional = optionalNode(
      "additionalQueryParams",
      leaf("taxNumber", s.partner?.taxNumber),
      leaf("groupMemberTaxNumber", s.partner?.groupMemberTaxNumber),
      leaf("name", s.partner?.name),
      leaf("invoiceCategory", s.invoiceCategory),
      leaf("paymentMethod", s.paymentMethod),
      leaf("invoiceAppearance", s.invoiceAppearance),
      leaf("source", s.source),
      leaf("currency", s.currency)
    );
    const relational = optionalNode(
      "relationalQueryParams",
      conditions("invoiceDelivery", r.invoiceDelivery),
      conditions("paymentDate", r.paymentDate),
      conditions("invoiceNetAmount", r.invoiceNetAmount),
      conditions("invoiceNetAmountHUF", r.invoiceNetAmountHUF),
      conditions("invoiceVatAmount", r.invoiceVatAmount),
      conditions("invoiceVatAmountHUF", r.invoiceVatAmountHUF)
    );
    const transaction = s.transaction
      ? node(
          "transactionQueryParams",
          leaf("transactionId", s.transaction.id),
          leaf("index", s.transaction.index),
          leaf("invoiceOperation", s.transaction.operation)
        )
      : "";
    return (
      leaf("page", s.page) +
      leaf("invoiceDirection", s.direction) +
      node("invoiceQueryParams", node("mandatoryQueryParams", mandatoryParams(s.window)), additional, relational, transaction)
    );
  },

  queryInvoiceChainDigest: (page: number, invoiceNumber: string, direction: string, taxNumber?: string): string =>
    leaf("page", page) +
    node(
      "invoiceChainQuery",
      leaf("invoiceNumber", invoiceNumber),
      leaf("invoiceDirection", direction),
      leaf("taxNumber", taxNumber)
    ),

  queryTransactionStatus: (transactionId: string, withOriginal: boolean): string =>
    leaf("transactionId", transactionId) + leaf("returnOriginalRequest", withOriginal),

  queryTransactionList: (page: number, from: string, to: string, status?: string): string =>
    leaf("page", page) + node("insDate", leaf("dateTimeFrom", from), leaf("dateTimeTo", to)) + leaf("requestStatus", status),

  manageInvoice: (token: string, items: InvoiceSubmission[], compressed: boolean): string =>
    leaf("exchangeToken", token) +
    node(
      "invoiceOperations",
      leaf("compressedContent", compressed),
      ...items.map((it) =>
        node(
          "invoiceOperation",
          leaf("index", it.index),
          leaf("invoiceOperation", it.operation),
          leaf("invoiceData", it.data),
          it.electronicInvoiceHash
            ? leaf("electronicInvoiceHash", it.electronicInvoiceHash.value, { cryptoType: it.electronicInvoiceHash.algorithm })
            : ""
        )
      )
    ),

  manageAnnulment: (token: string, items: AnnulmentSubmission[]): string =>
    leaf("exchangeToken", token) +
    node(
      "annulmentOperations",
      ...items.map((it) =>
        node("annulmentOperation", leaf("index", it.index), leaf("annulmentOperation", "ANNUL"), leaf("invoiceAnnulment", it.data))
      )
    ),
};
