import type {
  AnnulmentSubmission,
  InvoiceRef,
  InvoiceSearch,
  InvoiceSubmission,
  NavReply,
  NavSettings,
} from "./types.js";
import { decodeExchangeToken, indexHash } from "./auth.js";
import { envelope } from "./xml.js";
import { body } from "./operations.js";
import { asBool, parseXml, payloadOf, responseRoot, resultOf, unpackDocument, type Json } from "./response.js";

export type DocumentFormat = "json" | "xml";

/** Network-level failure: no usable NAV response arrived. */
export class NavUnreachable extends Error {
  constructor(message: string, readonly requestId: string) {
    super(message);
    this.name = "NavUnreachable";
  }
}

/** Thin client for invoiceService v3. One method per NAV operation. */
export class NavApi {
  constructor(private readonly settings: NavSettings) {}

  get env() {
    return this.settings.env;
  }

  private async call(operation: keyof typeof body, payload: string, indexHashes?: string[]): Promise<NavReply> {
    const { xml, requestId } = envelope(operation, this.settings, payload, { indexHashes });
    const isSubmission = indexHashes !== undefined;

    let res: Response;
    try {
      res = await fetch(`${this.settings.baseUrl}/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/xml", Accept: "application/xml" },
        body: xml,
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch (err) {
      const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new NavUnreachable(
        `No response from NAV ${operation} (${why}).` +
          (isSubmission
            ? " NAV may still have received the data: look it up with nav_list_transactions before sending it again."
            : ""),
        requestId
      );
    }

    const raw = await res.text();
    let doc: Json = {};
    try {
      doc = parseXml(raw);
    } catch {
      // handled below
    }
    const root = responseRoot(doc);
    if (!root) {
      throw new NavUnreachable(
        `NAV ${operation} answered HTTP ${res.status} with something that is not a NAV response: ` +
          raw.slice(0, 400).replace(/\s+/g, " "),
        requestId
      );
    }
    const result = resultOf(root.content);
    return {
      ok: result.funcCode === "OK",
      ...result,
      payload: payloadOf(root.content),
      httpStatus: res.status,
      requestId,
      raw,
    };
  }

  private async exchangeToken(): Promise<string> {
    const reply = await this.call("tokenExchange", body.tokenExchange());
    if (!reply.ok) {
      throw new Error(`Token exchange refused: ${[reply.errorCode, reply.message].filter(Boolean).join(" - ")}`);
    }
    const encoded = reply.payload.encodedExchangeToken;
    if (typeof encoded !== "string" || encoded === "") throw new Error("Token exchange returned no token.");
    return decodeExchangeToken(encoded, this.settings.credentials.exchangeKey);
  }

  taxpayer(taxNumber: string): Promise<NavReply> {
    return this.call("queryTaxpayer", body.queryTaxpayer(taxNumber));
  }

  /** Full invoice; the BASE64/GZIP invoiceData is unpacked in place. */
  async invoice(ref: InvoiceRef, as: DocumentFormat = "json"): Promise<NavReply> {
    const reply = await this.call("queryInvoiceData", body.queryInvoiceData(ref));
    const result = reply.payload.invoiceDataResult as Json | undefined;
    if (result && typeof result.invoiceData === "string") {
      try {
        result.invoiceData = unpackDocument(result.invoiceData, asBool(result.compressedContentIndicator), as);
      } catch (err) {
        result.unpackError = err instanceof Error ? err.message : String(err);
      }
    }
    return reply;
  }

  invoiceExists(ref: InvoiceRef): Promise<NavReply> {
    return this.call("queryInvoiceCheck", body.queryInvoiceCheck(ref));
  }

  searchInvoices(search: InvoiceSearch): Promise<NavReply> {
    return this.call("queryInvoiceDigest", body.queryInvoiceDigest(search));
  }

  invoiceChain(page: number, invoiceNumber: string, direction: string, partnerTaxNumber?: string): Promise<NavReply> {
    return this.call("queryInvoiceChainDigest", body.queryInvoiceChainDigest(page, invoiceNumber, direction, partnerTaxNumber));
  }

  /** Processing results; with `withOriginal` the submitted documents are unpacked too. */
  async transactionStatus(transactionId: string, withOriginal = false, as: DocumentFormat = "json"): Promise<NavReply> {
    const reply = await this.call("queryTransactionStatus", body.queryTransactionStatus(transactionId, withOriginal));
    const items = (reply.payload.processingResults as Json | undefined)?.processingResult;
    for (const item of Array.isArray(items) ? (items as Json[]) : []) {
      if (typeof item.originalRequest !== "string") continue;
      try {
        item.originalRequest = unpackDocument(item.originalRequest, asBool(item.compressedContentIndicator), as);
      } catch (err) {
        item.unpackError = err instanceof Error ? err.message : String(err);
      }
    }
    return reply;
  }

  transactions(page: number, from: string, to: string, status?: string): Promise<NavReply> {
    return this.call("queryTransactionList", body.queryTransactionList(page, from, to, status));
  }

  async submitInvoices(items: InvoiceSubmission[], compressed: boolean): Promise<NavReply> {
    const token = await this.exchangeToken();
    const hashes = items.map((it) => indexHash(it.operation, it.data));
    return this.call("manageInvoice", body.manageInvoice(token, items, compressed), hashes);
  }

  async annulInvoices(items: AnnulmentSubmission[]): Promise<NavReply> {
    const token = await this.exchangeToken();
    const hashes = items.map((it) => indexHash("ANNUL", it.data));
    return this.call("manageAnnulment", body.manageAnnulment(token, items), hashes);
  }
}
