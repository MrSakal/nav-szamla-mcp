# nav-szamla-mcp

Local MCP server for the Hungarian NAV Online Számla (Online Invoice) API v3.0. It lets Claude check taxpayers, search and read invoices, follow submissions, and submit invoice data reports.

- Runs locally only (stdio). Credentials are sent to `https://*.nav.gov.hu` and nowhere else; any other base URL is rejected.
- **Uses the NAV test environment by default.** Production has to be enabled explicitly with `"env": "production"`.
- Requests follow the element order of the official NAV XSDs; the request signature follows chapter 1.5 of the NAV interface specification.

## Setup

Requirements: Node.js 20.12+ and a NAV technical user ([test](https://onlineszamla-test.nav.gov.hu/) / [production](https://onlineszamla.nav.gov.hu/)).

```bash
git clone https://github.com/MrSakal/nav-szamla-mcp.git
cd nav-szamla-mcp
npm ci
npm run build
mkdir -p ~/.nav-szamla-mcp && cp config.example.json ~/.nav-szamla-mcp/config.json
```

Fill in `~/.nav-szamla-mcp/config.json` (Windows: `C:\Users\<you>\.nav-szamla-mcp\config.json`), then register the server with Claude Code:

```bash
claude mcp add nav-szamla --scope user -- node /absolute/path/to/nav-szamla-mcp/dist/main.js
```

If the file is missing, the server creates a blank one on first start. It is read again on every tool call, so edits apply without a restart. After changing the code, run `npm run build` and start a new Claude session.

## Configuration (`~/.nav-szamla-mcp/config.json`)

| Key | Required | Default | Description |
|---|---|---|---|
| `login` | yes | — | Technical user login (6–15 letters/digits) |
| `password` | yes | — | Password set when the technical user was created (only its SHA-512 hash is sent) |
| `taxNumber` | yes | — | 8-digit tax number (`12345678-1-42` also accepted) |
| `signatureKey` | yes | — | Signature key |
| `exchangeKey` | yes | — | Exchange key |
| `env` | no | `test` | `test` or `production` (production submissions are legally binding!) |
| `software.devName` | no | `MrSakal` | Developer name reported to NAV |
| `software.devContact` | no | `not-set` | Developer e-mail reported to NAV (the spec asks for a working address) |
| `software.devTaxNumber` | no | — | Developer tax number |
| `software.id` | no | `HU-NAVSZAMLA-MCP01` | Exactly 18 characters of `0-9`, `A-Z`, `-`; NAV recommends `HU` + developer tax number + own suffix |
| `software.name`, `software.version`, `software.devCountry` | no | app name, app version, `HU` | Other software details |
| `timeoutMs` | no | `60000` | HTTP timeout (NAV's absolute timeout is 60 s) |
| `baseUrl` | no | per `env` | Only `https://*.nav.gov.hu` or localhost |

The password and keys sit in plain text in this file. It is outside the repository, so it is never committed; keep it readable only by your user.

## Tools

| Tool | NAV operation | What it does |
|---|---|---|
| `nav_get_taxpayer` | queryTaxpayer | Taxpayer validity, name, addresses, VAT group |
| `nav_get_invoice` | queryInvoiceData | Full content of one invoice, unpacked (JSON, or `format: "xml"`) |
| `nav_invoice_exists` | queryInvoiceCheck | Whether a data report exists for an invoice |
| `nav_search_invoices` | queryInvoiceDigest | Search in pages of 100 by issue date, NAV receipt time or original invoice number (max. 35 days), with partner, amount and date filters |
| `nav_get_invoice_chain` | queryInvoiceChainDigest | An invoice with all its modifications and stornos |
| `nav_get_transaction_status` | queryTransactionStatus | Submission result per item, with validation messages |
| `nav_list_transactions` | queryTransactionList | Submissions within a time frame of at most 35 days |
| `nav_submit_invoices` ⚠️ | tokenExchange + manageInvoice | Invoice data reports (CREATE / MODIFY / STORNO), up to 100 items |
| `nav_annul_invoices` ⚠️ | tokenExchange + manageAnnulment | Technical annulment (must be approved on the NAV web interface) |

⚠️ = write operation; in production this is a real data report.

Prompts: `monthly-invoices` (all invoices of a month with totals), `check-partner`, `explain-transaction`.

## Project structure

```
src/
  main.ts              stdio entry point, creates a blank config.json if missing
  server.ts            builds the MCP server
  config.ts            reads and validates ~/.nav-szamla-mcp/config.json
  schemas.ts           tool input types (NAV simple types)
  prompts.ts           prompts
  tools/
    read-tools.ts      query tools
    write-tools.ts     submission tools
    respond.ts         response formatting, error handling
  nav/
    auth.ts            password hash, request signature, token decryption
    xml.ts             XML elements and the request envelope
    operations.ts      request body per operation
    response.ts        response parsing, BASE64/GZIP unpacking
    client.ts          HTTP calls, NAV operations
    types.ts           types
```

## Tests

```bash
npm test
```

Runs offline against a fake NAV. Covers the signature (using the worked example of NAV interface specification 1.5.1), the request envelope, response parsing, settings validation, and every tool end to end.

`XSD_SAMPLE_DIR=<dir> npm test` writes one sample request per operation; these can be validated against the [official NAV schemas](https://github.com/nav-gov-hu/Online-Invoice).

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `login is not set` | `config.json` still blank | Fill in `~/.nav-szamla-mcp/config.json` |
| `not valid JSON` | Typo in `config.json` | Check commas and quotes; backslashes must be doubled |
| `FORBIDDEN` | Technical user lacks a permission | Grant it in the NAV user manager (taxpayer and transaction queries need "Számlák kezelése") |
| `INVALID_SECURITY_USER` | Test user used against production, or the other way round | Check `env` |
| `INVALID_REQUEST_SIGNATURE` | Wrong signature key, or the system clock is off by more than a day | Copy the key again, fix the clock |
| `Could not decrypt the exchange token` | Wrong exchange key | Copy `exchangeKey` again |
| Timeout while submitting | NAV slow or network error | **Do not resend**; look it up with `nav_list_transactions` first |
| Claude does not see a change | Stale `dist/` | `npm run build`, then a new session |

## License

MIT © 2026 MrSakal, see [LICENSE](LICENSE).
