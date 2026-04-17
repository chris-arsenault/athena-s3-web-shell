import type { AuthProvider } from "../auth/AuthProvider";
import { CredentialsCache } from "../auth/credentialsCache";
import type { ApiOptions } from "./api";

/**
 * Bundles the two auth slots the proxy expects on every /api request:
 *   - `authHeader`     — identity (mock header or bearer JWT)
 *   - `awsCredentials` — per-user STS credentials; the proxy passes
 *                        these straight into the AWS SDK so Athena/Glue
 *                        calls run under the caller's own IAM role,
 *                        not the task role.
 *
 * Repos spread the result into `apiGet/Post/Delete` options:
 *     apiGet("/whatever", { ...(await proxyHeaders(provider)) })
 *
 * STS creds are cached across calls — schema + history + the column
 * crawler kick off ~10 parallel requests on page load, and each raw
 * `getCredentials()` hits Cognito Identity Pool. The cache coalesces
 * them onto a single inflight fetch and reuses the result until the
 * 5-min expiry window.
 */
let credsCache: CredentialsCache | null = null;

export async function proxyHeaders(
  provider: AuthProvider
): Promise<Pick<ApiOptions, "authHeader" | "awsCredentials">> {
  if (!credsCache) {
    credsCache = new CredentialsCache(() => provider.getCredentials());
  }
  const [authHeader, awsCredentials] = await Promise.all([
    provider.getProxyAuthHeader(),
    credsCache.get(),
  ]);
  return { authHeader, awsCredentials };
}
