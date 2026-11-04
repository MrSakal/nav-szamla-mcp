/** Which NAV Online Számla installation to talk to. */
export type NavEnv = "test" | "production";

export interface NavCredentials {
  login: string;
  password: string;
  /** 8-digit tax ID base number of the taxpayer the technical user belongs to */
  taxNumber: string;
  signatureKey: string;
  exchangeKey: string;
}

/** The <software> block every request must carry (invoiceApi.xsd SoftwareType). */
export interface SoftwareInfo {
  id: string;
  name: string;
  version: string;
  devName: string;
  devContact: string;
  devCountry?: string;
  devTaxNumber?: string;
}

export interface NavSettings {
  env: NavEnv;
  baseUrl: string;
  timeoutMs: number;
  credentials: NavCredentials;
  software: SoftwareInfo;
}

export type Direction = "INBOUND" | "OUTBOUND";
export type ManageOperation = "CREATE" | "MODIFY" | "STORNO";
export type Operator = "EQ" | "GT" | "GTE" | "LT" | "LTE";
export type HashAlgorithm = "SHA3-512" | "SHA-256";

export interface InvoiceRef {
  invoiceNumber: string;
  direction: Direction;
  batchIndex?: number;
  supplierTaxNumber?: string;
}

export interface Condition<V> {
  operator: Operator;
  value: V;
}

/** Search criteria of queryInvoiceDigest; `window` is the mandatory xs:choice. */
export interface InvoiceSearch {
  page: number;
  direction: Direction;
  window:
    | { kind: "issueDate"; from: string; to: string }
    | { kind: "insertedAt"; from: string; to: string }
    | { kind: "originalInvoice"; invoiceNumber: string };
  partner?: {
    taxNumber?: string;
    groupMemberTaxNumber?: string;
    name?: string;
  };
  invoiceCategory?: string;
  paymentMethod?: string;
  invoiceAppearance?: string;
  source?: string;
  currency?: string;
  ranges?: {
    invoiceDelivery?: Condition<string>[];
    paymentDate?: Condition<string>[];
    invoiceNetAmount?: Condition<number>[];
    invoiceNetAmountHUF?: Condition<number>[];
    invoiceVatAmount?: Condition<number>[];
    invoiceVatAmountHUF?: Condition<number>[];
  };
  transaction?: { id: string; index?: number; operation?: ManageOperation };
}

export interface InvoiceSubmission {
  index: number;
  operation: ManageOperation;
  /** BASE64 of the InvoiceData XML (GZIP first when the batch is compressed) */
  data: string;
  electronicInvoiceHash?: { value: string; algorithm: HashAlgorithm };
}

export interface AnnulmentSubmission {
  index: number;
  /** BASE64 of the InvoiceAnnulment XML */
  data: string;
}

/** What came back from one NAV call, already parsed. */
export interface NavReply {
  ok: boolean;
  funcCode: string;
  errorCode?: string;
  message?: string;
  notifications?: unknown;
  /** response root minus the echoed header/software/result blocks */
  payload: Record<string, unknown>;
  httpStatus: number;
  requestId: string;
  raw: string;
}
