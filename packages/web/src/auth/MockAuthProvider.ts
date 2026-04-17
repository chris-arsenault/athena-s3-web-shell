import { MOCK_USER_HEADER, type AuthContext, type AwsTempCredentials } from "@athena-shell/shared";

import type { AuthProvider } from "./AuthProvider";

const MOCK_CONTEXT: AuthContext = {
  userId: "dev-user",
  displayName: "Dev User",
  email: "dev@example.com",
  region: "us-east-1",
  roleArn: "arn:aws:iam::000000000000:role/dev-role",
  s3: { bucket: "athena-shell-dev", prefix: "users/dev/" },
  athena: {
    workgroup: "primary",
    outputLocation: "s3://athena-shell-dev/_athena/dev/",
    defaultDatabase: "default",
    userDatabase: "workspace_dev_user",
  },
};

export class MockAuthProvider implements AuthProvider {
  isMock(): boolean {
    return true;
  }

  async getContext(): Promise<AuthContext> {
    return MOCK_CONTEXT;
  }

  async getCredentials(): Promise<AwsTempCredentials> {
    const oneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return {
      accessKeyId: "MOCKKEY",
      secretAccessKey: "MOCKSECRET",
      sessionToken: "MOCKTOKEN",
      expiration: oneHour,
    };
  }

  async getProxyAuthHeader(): Promise<{ name: string; value: string }> {
    return { name: MOCK_USER_HEADER, value: MOCK_CONTEXT.userId };
  }

  async signOut(): Promise<void> {}
}
