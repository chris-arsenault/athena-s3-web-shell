import type { Request } from "express";
import type { AuthContext } from "@athena-shell/shared";

import { UnauthorizedError, type AuthProvider } from "./authProvider.js";

export interface AlbAuthConfig {
  region: string;
  accountId: string;
  /** Resource naming prefix (e.g. "athena-shell"). Used to build per-user workgroup + role ARN. */
  namePrefix: string;
  dataBucket: string;
  resultsBucket: string;
  glueDatabase: string;
}

/**
 * AlbAuthProvider — used when the app sits behind an ALB that performs
 * `jwt-validation` on each /api/* request.
 *
 * The ALB:
 *   - Validates the incoming `Authorization: Bearer <JWT>` against Cognito's
 *     JWKS (issuer + signature + expiry) BEFORE the proxy sees the request.
 *   - Forwards the request with the Authorization header intact.
 *   - MAY inject `x-amzn-oidc-identity` + `x-amzn-oidc-data` if claims-mapping
 *     is configured on the listener rule — but aws provider 6.41 doesn't
 *     expose that attribute yet, so we can't rely on those headers.
 *   - On validation failure, returns 401 before the proxy ever sees it.
 *
 * This provider therefore:
 *   1. Reads `Authorization: Bearer <token>` (the SPA always sends it).
 *   2. Decodes the JWT payload (base64 of the middle segment) — NO signature
 *      check; ALB already did that. Re-verifying would require a second
 *      JWKS dependency for no gain.
 *   3. Falls back to `x-amzn-oidc-data` if present, so if claims-mapping
 *      gets wired on the listener later the proxy keeps working.
 *   4. Derives Athena workgroup + S3 prefix deterministically from the
 *      `cognito:username` claim, matching the Terraform resource names.
 *
 * FUTURE (SSO): under Entra federation, users are identified by group
 * membership rather than individual identity. Swap the derivation for a
 * `cognito:groups` → workgroup lookup (small static map loaded at startup
 * from SSM or config), and drop the per-user role flavor.
 */
export class AlbAuthProvider implements AuthProvider {
  constructor(private readonly config: AlbAuthConfig) {}

  async resolve(req: Request): Promise<AuthContext> {
    const claims = extractClaims(req);
    const sub = pickString(claims, "sub");
    if (!sub) {
      throw new UnauthorizedError(
        "No usable JWT on request — ALB jwt-validation is not wired, or the SPA forgot the Authorization header."
      );
    }

    const username = pickString(claims, "cognito:username") ?? sub;
    const prefix = `users/${username}/`;

    return {
      userId: sub,
      displayName: pickString(claims, "cognito:username", "email") ?? sub,
      email: pickString(claims, "email") ?? "",
      region: this.config.region,
      roleArn: `arn:aws:iam::${this.config.accountId}:role/${this.config.namePrefix}-user-${username}`,
      s3: {
        bucket: this.config.dataBucket,
        prefix,
      },
      athena: {
        workgroup: `${this.config.namePrefix}-${username}`,
        outputLocation: `s3://${this.config.resultsBucket}/${prefix}`,
        // Default DB = the caller's own workspace, so unqualified SELECTs
        // resolve against their own tables (SELECT * FROM customers works
        // for workspace_test_athena_1.customers without prefixing). Tables
        // in the shared demo DB stay addressable via athena_shell_demo.x.
        defaultDatabase: `workspace_${username}`,
        userDatabase: `workspace_${username}`,
      },
    };
  }
}

type Claims = Record<string, unknown>;

/**
 * Primary source: Authorization: Bearer <JWT>.
 * Fallback: x-amzn-oidc-data (ALB-re-signed JWT when claims-mapping is on).
 */
function extractClaims(req: Request): Claims {
  const fromAuth = decodeJwtPayload(stripBearer(req.header("authorization")));
  if (fromAuth["sub"]) return fromAuth;
  return decodeJwtPayload(req.header("x-amzn-oidc-data"));
}

function stripBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function decodeJwtPayload(raw?: string): Claims {
  if (!raw) return {};
  const parts = raw.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = parts[1]!;
    const decoded = Buffer.from(padBase64(payload), "base64").toString("utf8");
    return JSON.parse(decoded) as Claims;
  } catch {
    return {};
  }
}

function padBase64(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const rem = padded.length % 4;
  return rem === 0 ? padded : padded + "=".repeat(4 - rem);
}

function pickString(claims: Claims, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = claims[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
