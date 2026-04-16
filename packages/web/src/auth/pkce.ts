/**
 * Raw PKCE helpers — no Amplify, no oidc-client-ts, no outside library.
 *
 * The flow implements RFC 7636 (S256) directly against window.crypto.subtle:
 *   1. Generate a random verifier (43-128 chars, unreserved URL chars).
 *   2. SHA-256 the verifier, base64url-encode the digest → challenge.
 *   3. Send challenge + "S256" with /oauth2/authorize.
 *   4. Send verifier with /oauth2/token.
 */

const VERIFIER_LENGTH = 64;
const UNRESERVED =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function randomString(length = VERIFIER_LENGTH): string {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += UNRESERVED[b % UNRESERVED.length];
  return out;
}

export async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return window
    .btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
