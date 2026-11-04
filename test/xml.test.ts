import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envelope } from "../src/nav/xml.js";
import { body } from "../src/nav/operations.js";
import { parseXml, responseRoot, resultOf, unpackDocument } from "../src/nav/response.js";
import { ensureConfigFile, loadSettings, readConfigFile } from "../src/config.js";
import { SETTINGS_SOURCE } from "./fixtures.js";

/**
 * One request per operation. With XSD_SAMPLE_DIR set they are written to disk so they can be
 * validated against the official NAV schemas (see README, "XSD check").
 */
test("every operation produces a request envelope", () => {
  const settings = loadSettings(SETTINGS_SOURCE);
  const doc = Buffer.from("<InvoiceData/>").toString("base64");
  const ref = { invoiceNumber: "SZ/2026/0001", direction: "INBOUND" as const, batchIndex: 2, supplierTaxNumber: "12345678" };
  const samples: Record<string, string> = {
    tokenExchange: body.tokenExchange(),
    queryTaxpayer: body.queryTaxpayer("01234567"),
    queryInvoiceData: body.queryInvoiceData(ref),
    queryInvoiceCheck: body.queryInvoiceCheck({ invoiceNumber: "SZ/2026/0001", direction: "OUTBOUND" }),
    queryInvoiceDigest: body.queryInvoiceDigest({
      page: 1,
      direction: "OUTBOUND",
      window: { kind: "issueDate", from: "2026-01-01", to: "2026-01-31" },
      partner: { taxNumber: "12345678", name: "Example Ltd" },
      invoiceCategory: "NORMAL",
      currency: "HUF",
      ranges: {
        invoiceNetAmountHUF: [{ operator: "GTE", value: 1000 }, { operator: "LTE", value: 250000.5 }],
        paymentDate: [{ operator: "LT", value: "2026-03-01" }],
      },
      transaction: { id: "TX0001", index: 1, operation: "CREATE" },
    }),
    queryInvoiceChainDigest: body.queryInvoiceChainDigest(1, "SZ/2026/0001", "OUTBOUND", "12345678"),
    queryTransactionStatus: body.queryTransactionStatus("TX0001", true),
    queryTransactionList: body.queryTransactionList(1, "2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z", "FINISHED"),
    manageInvoice: body.manageInvoice(
      "TOKEN",
      [
        { index: 1, operation: "CREATE", data: doc },
        { index: 2, operation: "STORNO", data: doc, electronicInvoiceHash: { value: "B".repeat(128), algorithm: "SHA3-512" } },
      ],
      false
    ),
    manageAnnulment: body.manageAnnulment("TOKEN", [{ index: 1, data: doc }]),
  };

  const dir = process.env.XSD_SAMPLE_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [operation, content] of Object.entries(samples)) {
    const { xml } = envelope(operation, settings, content, { now: new Date("2026-02-01T08:00:00.250Z"), requestId: "RTEST1" });
    const root = operation.charAt(0).toUpperCase() + operation.slice(1) + "Request";
    assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<${root} `), operation);
    if (dir) writeFileSync(join(dir, `${root}.xml`), xml);
  }
  assert.match(samples.queryTransactionList!, /^<page>1<\/page><insDate><dateTimeFrom>/);
});

test("values are escaped", () => {
  const xml = body.queryInvoiceCheck({ invoiceNumber: `A<B>&"C'`, direction: "OUTBOUND" });
  assert.match(xml, /<invoiceNumber>A&lt;B&gt;&amp;&quot;C&apos;<\/invoiceNumber>/);
});

test("parser keeps digit strings intact", () => {
  const doc = parseXml(
    `<QueryTaxpayerResponse><result><funcCode>OK</funcCode></result><taxpayerData><taxNumberDetail><taxpayerId>01234567</taxpayerId></taxNumberDetail></taxpayerData></QueryTaxpayerResponse>`
  );
  const root = responseRoot(doc)!;
  assert.equal((root.content.taxpayerData as any).taxNumberDetail.taxpayerId, "01234567");
});

test("GeneralExceptionResponse is read from the root", () => {
  const doc = parseXml(
    `<ns2:GeneralExceptionResponse xmlns:ns2="http://schemas.nav.gov.hu/NTCA/1.0/common"><ns2:funcCode>ERROR</ns2:funcCode><ns2:errorCode>INVALID_REQUEST</ns2:errorCode><ns2:message>bad XML</ns2:message></ns2:GeneralExceptionResponse>`
  );
  const r = resultOf(responseRoot(doc)!.content);
  assert.equal(r.funcCode, "ERROR");
  assert.equal(r.errorCode, "INVALID_REQUEST");
  assert.equal(r.message, "bad XML");
});

test("embedded documents unpack from plain and GZIP BASE64; lines are always arrays", () => {
  const xml = `<InvoiceData><invoiceNumber>0007</invoiceNumber><invoiceMain><invoice><invoiceLines><line><lineNumber>1</lineNumber></line></invoiceLines></invoice></invoiceMain></InvoiceData>`;
  const plain = unpackDocument(Buffer.from(xml).toString("base64"), false, "json") as any;
  assert.equal(plain.InvoiceData.invoiceNumber, "0007");
  assert.ok(Array.isArray(plain.InvoiceData.invoiceMain.invoice.invoiceLines.line));
  assert.equal(unpackDocument(gzipSync(xml).toString("base64"), true, "xml"), xml);
});

test("settings: test by default, strict validation, NAV-only base URL", () => {
  const { env: _drop, ...noEnv } = SETTINGS_SOURCE;
  const s = loadSettings(noEnv);
  assert.equal(s.env, "test");
  assert.match(s.baseUrl, /^https:\/\/api-test\.onlineszamla\.nav\.gov\.hu\//);
  assert.equal(s.software.devContact, "not-set");
  assert.equal(s.software.devName, "MrSakal");
  assert.equal(s.software.id, "HU-NAVSZAMLA-MCP01");
  assert.equal(loadSettings({ ...SETTINGS_SOURCE, taxNumber: "12345678-2-42" }).credentials.taxNumber, "12345678");
  assert.equal(loadSettings({ ...SETTINGS_SOURCE, software: { devContact: "dev@example.com" } }).software.devContact, "dev@example.com");
  assert.throws(() => loadSettings({ ...SETTINGS_SOURCE, env: "prod" }), /env must be/);
  assert.throws(() => loadSettings({ ...SETTINGS_SOURCE, login: "bad id" }), /login/);
  assert.throws(() => loadSettings({ ...SETTINGS_SOURCE, password: "" }), /password is not set/);
  assert.throws(() => loadSettings({ ...SETTINGS_SOURCE, taxNumber: 12345678 as unknown as string }), /taxNumber must be a string/);
  assert.throws(() => loadSettings({ ...SETTINGS_SOURCE, baseUrl: "https://example.com/v3" }), /nav\.gov\.hu/);
  assert.throws(() => loadSettings({ ...SETTINGS_SOURCE, baseUrl: "https://nav.gov.hu.example.com/v3" }), /nav\.gov\.hu/);
  assert.throws(() => loadSettings({ ...SETTINGS_SOURCE, baseUrl: "http://api.onlineszamla.nav.gov.hu/v3" }), /nav\.gov\.hu/);
  assert.doesNotThrow(() => loadSettings({ ...SETTINGS_SOURCE, baseUrl: "http://127.0.0.1:9000/v3" }));
});

test("config file: blank one is created, then read; broken JSON is reported with its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "nav-cfg-"));
  try {
    const path = join(dir, "sub", "config.json");
    assert.equal(ensureConfigFile(path), true);
    assert.equal(ensureConfigFile(path), false);
    const blank = readConfigFile(path);
    assert.equal(blank.env, "test");
    assert.equal(blank.login, "");
    assert.throws(() => loadSettings(blank), /login is not set/);

    writeFileSync(path, "﻿" + JSON.stringify({ ...SETTINGS_SOURCE, env: "production" }));
    assert.equal(loadSettings(readConfigFile(path)).env, "production");

    writeFileSync(path, "{ not json");
    assert.throws(() => readConfigFile(path), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
