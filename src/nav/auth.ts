import { createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Authentication primitives from the NAV Online Számla interface specification, chapter 1.5.
 * Every hash NAV expects is upper-case hex.
 */

export function sha512Upper(text: string): string {
  return createHash("sha512").update(text, "utf8").digest("hex").toUpperCase();
}

/** SHA3-512 (FIPS 202) via Node's OpenSSL. */
export function sha3Upper(text: string): string {
  return createHash("sha3-512").update(text, "utf8").digest("hex").toUpperCase();
}

/** user/passwordHash, cryptoType="SHA-512" */
export const passwordHash = (password: string): string => sha512Upper(password);

/** "2017-12-30T18:25:45.000Z" -> "20171230182545" (UTC, separators and millis dropped) */
export function compactTimestamp(isoUtc: string): string {
  return isoUtc.slice(0, 19).replace(/\D/g, "");
}

/** Per-item hash of manageInvoice / manageAnnulment: operation literal + BASE64 exactly as sent. */
export const indexHash = (operation: string, base64: string): string => sha3Upper(operation + base64);

/**
 * user/requestSignature, cryptoType="SHA3-512".
 * Plain queries sign requestId + timestamp + key; submissions append the index hashes in index order.
 */
export function requestSignature(args: {
  requestId: string;
  timestamp: string;
  signatureKey: string;
  indexHashes?: readonly string[];
}): string {
  const partial = args.requestId + compactTimestamp(args.timestamp) + args.signatureKey;
  return sha3Upper(partial + (args.indexHashes ?? []).join(""));
}

/** tokenExchange returns the data-reporting token AES-128-ECB encrypted with the exchange key. */
export function decodeExchangeToken(encodedBase64: string, exchangeKey: string): string {
  const key = Buffer.from(exchangeKey, "utf8");
  if (key.length < 16) throw new Error("The exchange key must be at least 16 bytes long (AES-128).");
  const decipher = createDecipheriv("aes-128-ecb", key.subarray(0, 16), null);
  try {
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encodedBase64.replace(/\s+/g, ""), "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    throw new Error("Could not decrypt the exchange token. Is exchangeKey in config.json correct?");
  }
}

/** header/requestId: [+a-zA-Z0-9_]{1,30}, must be unique per taxpayer. 29 chars here. */
export function newRequestId(): string {
  return "R" + Date.now().toString(36).toUpperCase().padStart(8, "0") + randomBytes(10).toString("hex");
}
