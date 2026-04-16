import type { AuthContext, AwsTempCredentials } from "@athena-shell/shared";

export interface AuthProvider {
  getContext(): Promise<AuthContext>;
  getCredentials(): Promise<AwsTempCredentials>;
  signOut(): Promise<void>;
  /** Returns the header value to send to the proxy for request-level auth (X-Mock-User in dev, bearer JWT in prod). */
  getProxyAuthHeader(): Promise<{ name: string; value: string } | null>;
  /** Hook for repos to detect mock mode and route to in-memory fakes instead of real AWS. */
  isMock(): boolean;
}
