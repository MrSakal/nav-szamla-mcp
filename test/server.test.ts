import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createCipheriv } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNavServer } from "../src/server.js";
import { SETTINGS_SOURCE } from "./fixtures.js";

type Call = { url: string; xml: string };

/** Starts the server in-process and replaces fetch with a fake NAV. */
async function harness(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fake = mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const call = { url: String(url), xml: String(init.body) };
    calls.push(call);
    return answer(call);
  });
  const server = createNavServer(SETTINGS_SOURCE);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name, arguments: args });
    return { error: r.isError === true, text: r.content[0].text as string };
  };
  return { calls, call, client, done: () => fake.mock.restore() };
}

const navXml = (root: string, inner: string) =>
  new Response(`<${root} xmlns="http://schemas.nav.gov.hu/OSA/3.0/api"><result><funcCode>OK</funcCode></result>${inner}</${root}>`);

test("tool list", async () => {
  const h = await harness(() => new Response(""));
  try {
    const { tools } = await h.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "nav_annul_invoices", "nav_get_invoice", "nav_get_invoice_chain", "nav_get_taxpayer",
      "nav_get_transaction_status", "nav_invoice_exists", "nav_list_transactions",
      "nav_search_invoices", "nav_submit_invoices",
    ]);
    const { prompts } = await h.client.listPrompts();
    assert.equal(prompts.length, 3);
  } finally {
    h.done();
  }
});

test("nav_list_transactions sends insDate in UTC to the test endpoint", async () => {
  const h = await harness(() => navXml("QueryTransactionListResponse", "<transactionListResult><currentPage>1</currentPage><availablePage>1</availablePage><transaction><transactionId>00A1</transactionId></transaction></transactionListResult>"));
  try {
    const r = await h.call("nav_list_transactions", { from: "2026-01-01T00:00:00+01:00", to: "2026-01-20T00:00:00Z" });
    assert.equal(r.error, false, r.text);
    assert.equal(h.calls[0]!.url, "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3/queryTransactionList");
    assert.match(h.calls[0]!.xml, /<insDate><dateTimeFrom>2025-12-31T23:00:00\.000Z<\/dateTimeFrom><dateTimeTo>2026-01-20T00:00:00\.000Z<\/dateTimeTo><\/insDate>/);
    assert.match(r.text, /^NAV test: OK/);
    assert.match(r.text, /"transactionId": "00A1"/);
  } finally {
    h.done();
  }
});

test("nav_get_invoice unpacks GZIP invoice data and normalises the supplier tax number", async () => {
  const packed = gzipSync(`<InvoiceData><invoiceNumber>SZ-9</invoiceNumber></InvoiceData>`).toString("base64");
  const h = await harness(() =>
    navXml("QueryInvoiceDataResponse", `<invoiceDataResult><invoiceData>${packed}</invoiceData><auditData/><compressedContentIndicator>true</compressedContentIndicator></invoiceDataResult>`)
  );
  try {
    const r = await h.call("nav_get_invoice", { invoiceNumber: "SZ-9", direction: "INBOUND", supplierTaxNumber: "12345678-2-42" });
    assert.equal(r.error, false, r.text);
    assert.match(h.calls[0]!.xml, /<supplierTaxNumber>12345678<\/supplierTaxNumber>/);
    assert.match(r.text, /"invoiceNumber": "SZ-9"/);
  } finally {
    h.done();
  }
});

test("nav_search_invoices enforces one time frame and the 35-day limit locally", async () => {
  const h = await harness(() => {
    throw new Error("NAV must not be called");
  });
  try {
    assert.match((await h.call("nav_search_invoices", { direction: "OUTBOUND" })).text, /exactly one time frame/);
    assert.match(
      (await h.call("nav_search_invoices", { direction: "OUTBOUND", issuedFrom: "2026-01-01", issuedTo: "2026-02-15" })).text,
      /35 days/
    );
    assert.equal(h.calls.length, 0);
  } finally {
    h.done();
  }
});

test("nav_submit_invoices: token exchange, signed batch, transaction ID in the answer", async () => {
  const key = SETTINGS_SOURCE.exchangeKey;
  const c = createCipheriv("aes-128-ecb", Buffer.from(key), null);
  const encToken = Buffer.concat([c.update("SECRET-TOKEN"), c.final()]).toString("base64");
  const h = await harness(({ url }) =>
    url.endsWith("/tokenExchange")
      ? navXml("TokenExchangeResponse", `<encodedExchangeToken>${encToken}</encodedExchangeToken><tokenValidityFrom>x</tokenValidityFrom><tokenValidityTo>y</tokenValidityTo>`)
      : navXml("ManageInvoiceResponse", "<transactionId>4ABCDEF</transactionId>")
  );
  try {
    const data = Buffer.from("<InvoiceData/>").toString("base64");
    const r = await h.call("nav_submit_invoices", { items: [{ index: 1, operation: "CREATE", data }] });
    assert.equal(r.error, false, r.text);
    assert.equal(h.calls.length, 2);
    assert.match(h.calls[1]!.xml, /<exchangeToken>SECRET-TOKEN<\/exchangeToken>/);
    assert.match(h.calls[1]!.xml, /<invoiceOperations><compressedContent>false<\/compressedContent><invoiceOperation><index>1<\/index><invoiceOperation>CREATE<\/invoiceOperation>/);
    assert.match(r.text, /Transaction ID: 4ABCDEF/);
  } finally {
    h.done();
  }
});

test("nav_submit_invoices rejects gaps and non-XML data without calling NAV", async () => {
  const h = await harness(() => {
    throw new Error("NAV must not be called");
  });
  try {
    const xml = Buffer.from("<InvoiceData/>").toString("base64");
    const gap = await h.call("nav_submit_invoices", {
      items: [{ index: 1, operation: "CREATE", data: xml }, { index: 3, operation: "CREATE", data: xml }],
    });
    assert.match(gap.text, /without gaps/);
    const text = await h.call("nav_submit_invoices", {
      items: [{ index: 1, operation: "CREATE", data: Buffer.from("not xml").toString("base64") }],
    });
    assert.match(text.text, /does not contain an XML/);
    assert.equal(h.calls.length, 0);
  } finally {
    h.done();
  }
});

test("a non-NAV HTTP answer becomes a clear error", async () => {
  const h = await harness(() => new Response("<html>502</html>", { status: 502 }));
  try {
    const r = await h.call("nav_get_taxpayer", { taxNumber: "12345678" });
    assert.equal(r.error, true);
    assert.match(r.text, /HTTP 502/);
  } finally {
    h.done();
  }
});
