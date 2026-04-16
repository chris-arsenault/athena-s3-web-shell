import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";

import type { AuthContext, AwsTempCredentials } from "@athena-shell/shared";

import type { AuthProvider } from "./AuthProvider";
import { randomString, sha256Base64Url } from "./pkce";
import {
  clearSession,
  isExpired,
  readPkceTransient,
  readSession,
  savePkceTransient,
  writeSession,
  type SessionTokens,
} from "./oidcSession";

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  identityPoolId: string;
  /** Hosted UI domain, e.g. "auth.services.ahara.io" — no scheme. */
  domain: string;
}

export class CognitoAuthProvider implements AuthProvider {
  constructor(private readonly config: CognitoConfig) {}

  isMock(): boolean {
    return false;
  }

  /** Kick off /oauth2/authorize with PKCE. Does not return (page unloads). */
  async signInRedirect(returnTo: string = window.location.pathname): Promise<never> {
    const verifier = randomString();
    const challenge = await sha256Base64Url(verifier);
    const state = randomString(32);
    savePkceTransient(verifier, state, returnTo);

    const url = new URL(`https://${this.config.domain}/oauth2/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri());
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    window.location.assign(url.toString());
    return new Promise(() => undefined);
  }

  /**
   * Exchange the authorization code for tokens. Called by /auth/callback
   * after Cognito redirects back. Returns the original return URL so the
   * caller can navigate the SPA router there.
   */
  async completeSignIn(code: string, state: string): Promise<string> {
    const transient = readPkceTransient();
    if (!transient) throw new Error("Missing PKCE verifier — retry login");
    if (transient.state !== state) throw new Error("State mismatch — possible CSRF");

    const res = await fetch(`https://${this.config.domain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        code,
        redirect_uri: this.redirectUri(),
        code_verifier: transient.verifier,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    const body = (await res.json()) as {
      id_token: string;
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    writeSession({
      idToken: body.id_token,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    });

    clearPkceArtifacts();
    return transient.returnTo;
  }

  async getContext(): Promise<AuthContext> {
    const session = await this.requireSession();
    const res = await fetch("/api/session", {
      headers: { Authorization: `Bearer ${session.idToken}` },
    });
    if (res.status === 401) return this.signInRedirect();
    if (!res.ok) throw new Error(`/api/session failed: ${res.status}`);
    return (await res.json()) as AuthContext;
  }

  async getCredentials(): Promise<AwsTempCredentials> {
    const session = await this.requireSession();
    const loginKey = `cognito-idp.${this.config.region}.amazonaws.com/${this.config.userPoolId}`;
    const getCreds = fromCognitoIdentityPool({
      clientConfig: { region: this.config.region },
      identityPoolId: this.config.identityPoolId,
      logins: { [loginKey]: session.idToken },
    });
    const creds = await getCreds();
    return {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken ?? "",
      expiration: creds.expiration?.toISOString() ?? new Date(Date.now() + 3600_000).toISOString(),
    };
  }

  async getProxyAuthHeader(): Promise<{ name: string; value: string } | null> {
    const session = readSession();
    if (!session || isExpired(session)) return null;
    return { name: "Authorization", value: `Bearer ${session.idToken}` };
  }

  async signOut(): Promise<void> {
    clearSession();
    const url = new URL(`https://${this.config.domain}/logout`);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("logout_uri", window.location.origin);
    window.location.assign(url.toString());
  }

  private redirectUri(): string {
    return `${window.location.origin}/auth/callback`;
  }

  private async requireSession(): Promise<SessionTokens> {
    const session = readSession();
    if (!session || isExpired(session)) {
      await this.signInRedirect();
    }
    return readSession()!;
  }
}

function clearPkceArtifacts(): void {
  window.sessionStorage.removeItem("athena-shell.oidc.verifier");
  window.sessionStorage.removeItem("athena-shell.oidc.state");
  window.sessionStorage.removeItem("athena-shell.oidc.return_to");
}
