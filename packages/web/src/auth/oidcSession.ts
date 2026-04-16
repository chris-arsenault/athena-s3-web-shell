/**
 * Token storage for the Cognito OIDC session.
 *
 * Strategy: sessionStorage (survives reload within a tab, cleared on tab
 * close). Tokens never touch localStorage — per enterprise browser policy
 * guidance. On reload the SPA reads the same tokens back; if they've expired
 * the provider triggers a re-auth.
 *
 * A short-lived "transient" store is used during the PKCE redirect to hold
 * the code_verifier + state across the hosted-UI round trip.
 */

const KEY_TOKENS = "athena-shell.oidc.tokens";
const KEY_VERIFIER = "athena-shell.oidc.verifier";
const KEY_STATE = "athena-shell.oidc.state";
const KEY_RETURN_TO = "athena-shell.oidc.return_to";

export interface SessionTokens {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export function readSession(): SessionTokens | null {
  const raw = window.sessionStorage.getItem(KEY_TOKENS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionTokens;
  } catch {
    return null;
  }
}

export function writeSession(t: SessionTokens): void {
  window.sessionStorage.setItem(KEY_TOKENS, JSON.stringify(t));
}

export function clearSession(): void {
  window.sessionStorage.removeItem(KEY_TOKENS);
  clearPkceTransient();
}

export function isExpired(t: SessionTokens, skewMs = 60_000): boolean {
  return Date.now() + skewMs >= t.expiresAt;
}

export function savePkceTransient(
  verifier: string,
  state: string,
  returnTo: string
): void {
  window.sessionStorage.setItem(KEY_VERIFIER, verifier);
  window.sessionStorage.setItem(KEY_STATE, state);
  window.sessionStorage.setItem(KEY_RETURN_TO, returnTo);
}

export interface PkceTransient {
  verifier: string;
  state: string;
  returnTo: string;
}

export function readPkceTransient(): PkceTransient | null {
  const verifier = window.sessionStorage.getItem(KEY_VERIFIER);
  const state = window.sessionStorage.getItem(KEY_STATE);
  const returnTo = window.sessionStorage.getItem(KEY_RETURN_TO);
  if (!verifier || !state) return null;
  return { verifier, state, returnTo: returnTo ?? "/" };
}

export function clearPkceTransient(): void {
  window.sessionStorage.removeItem(KEY_VERIFIER);
  window.sessionStorage.removeItem(KEY_STATE);
  window.sessionStorage.removeItem(KEY_RETURN_TO);
}
