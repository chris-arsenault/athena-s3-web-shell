import type { AuthContext, AwsTempCredentials } from "@athena-shell/shared";

import type { AuthProvider } from "./AuthProvider";

export class CognitoAuthProvider implements AuthProvider {
  isMock(): boolean {
    return false;
  }
  async getContext(): Promise<AuthContext> {
    throw new Error("CognitoAuthProvider not implemented (v2)");
  }
  async getCredentials(): Promise<AwsTempCredentials> {
    throw new Error("CognitoAuthProvider not implemented (v2)");
  }
  async getProxyAuthHeader(): Promise<{ name: string; value: string } | null> {
    return null;
  }
  async signOut(): Promise<void> {}
}
