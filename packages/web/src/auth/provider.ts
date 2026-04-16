import type { AuthProvider } from "./AuthProvider";
import { CognitoAuthProvider } from "./CognitoAuthProvider";
import { MockAuthProvider } from "./MockAuthProvider";

/**
 * Build-time auth provider selection.
 *
 * Switched via `VITE_AUTH_PROVIDER` — set by the Dockerfile (to "cognito")
 * for the deployed build, defaulted to "mock" for local dev.
 *
 * Production builds that select "cognito" MUST also set:
 *   VITE_COGNITO_REGION
 *   VITE_COGNITO_USER_POOL_ID
 *   VITE_COGNITO_CLIENT_ID
 *   VITE_COGNITO_IDENTITY_POOL_ID
 *   VITE_COGNITO_DOMAIN
 *
 * Missing any of them throws at module load rather than silently falling
 * back to mock — this is the backstop against "deployed build is silently
 * mock-mode."
 */
export const provider: AuthProvider = createProvider();

function createProvider(): AuthProvider {
  const mode = (import.meta.env.VITE_AUTH_PROVIDER ?? "mock").toLowerCase();
  if (mode === "cognito") {
    return new CognitoAuthProvider({
      region: requireEnv("VITE_COGNITO_REGION"),
      userPoolId: requireEnv("VITE_COGNITO_USER_POOL_ID"),
      clientId: requireEnv("VITE_COGNITO_CLIENT_ID"),
      identityPoolId: requireEnv("VITE_COGNITO_IDENTITY_POOL_ID"),
      domain: requireEnv("VITE_COGNITO_DOMAIN"),
    });
  }
  if (mode !== "mock") {
    throw new Error(`Unknown VITE_AUTH_PROVIDER: ${mode}`);
  }
  return new MockAuthProvider();
}

function requireEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value || typeof value !== "string") {
    throw new Error(
      `${name} is required when VITE_AUTH_PROVIDER=cognito. Set it at build time.`
    );
  }
  return value;
}
