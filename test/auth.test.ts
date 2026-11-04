import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { compactTimestamp, decodeExchangeToken, indexHash, newRequestId, passwordHash, requestSignature } from "../src/nav/auth.js";

test("signature reproduces the worked example of NAV interface spec 1.5.1", () => {
  const first = indexHash("CREATE", "QWJjZDEyMzQ=");
  const second = indexHash("MODIFY", "RGNiYTQzMjE=");
  assert.equal(first, "4317798460962869BC67F07C48EA7E4A3AFA301513CEB87B8EB94ECF92BC220A89C480F87F0860E85E29A3B6C0463D4F29712C5AD48104A6486CE839DC2F24CB");
  assert.equal(second, "A881218238933F6FFB9E167445CB4DAA9749BCF484FDE48AB7649FD25E8B634A4736A65A7C4A8E2831119F739837E006566F97370415AAD55E268605206F2A6C");
  assert.equal(
    requestSignature({
      requestId: "TSTKFT1222564",
      timestamp: "2017-12-30T18:25:45.000Z",
      signatureKey: "ce-8f5e-215119fa7dd621DLMRHRLH2S",
      indexHashes: [first, second],
    }),
    "60BC80609EE3B8F42FE904200A49A1921A1DADA08D55319ACD40C59F626514B74EEA49011D372600A10DBCF8199D590DA9C2841D987308F2D83DAE17C2470C42"
  );
});

test("timestamp is compacted to YYYYMMDDhhmmss", () => {
  assert.equal(compactTimestamp("2017-12-30T18:25:45.000Z"), "20171230182545");
});

test("password hash is upper-case SHA-512", () => {
  assert.match(passwordHash("x"), /^[0-9A-F]{128}$/);
});

test("request IDs fit EntityIdType and do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = newRequestId();
    assert.match(id, /^[+a-zA-Z0-9_]{1,30}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 500);
});

test("exchange token decrypts with AES-128-ECB", () => {
  const key = "0123456789abcdef";
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(key), null);
  const encoded = Buffer.concat([cipher.update("token-xyz", "utf8"), cipher.final()]).toString("base64");
  assert.equal(decodeExchangeToken(encoded, key), "token-xyz");
  assert.throws(() => decodeExchangeToken(encoded, "fedcba9876543210"), /exchangeKey/);
});
