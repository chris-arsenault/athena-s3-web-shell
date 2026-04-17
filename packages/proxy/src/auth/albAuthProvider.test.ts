import { describe, expect, it } from "vitest";
import type { Request } from "express";

import { AlbAuthProvider, type AlbAuthConfig } from "./albAuthProvider.js";
import { UnauthorizedError } from "./authProvider.js";

const CONFIG: AlbAuthConfig = {
  region: "us-east-1",
  accountId: "123456789012",
  namePrefix: "athena-shell",
  dataBucket: "athena-shell-data",
  resultsBucket: "athena-shell-results",
  glueDatabase: "athena_shell_demo",
};

// ---------------------------------------------------------------------------
// Test helpers

function fakeReq(headers: Record<string, string>): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    header: (name: string) => lower[name.toLowerCase()],
  } as unknown as Request;
}

function base64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  return `${header}.${payload}.sig`;
}

// ---------------------------------------------------------------------------
// Reject paths

describe("AlbAuthProvider — rejects", () => {
  it("throws UnauthorizedError when no bearer and no x-amzn-oidc-data", async () => {
    await expect(
      new AlbAuthProvider(CONFIG).resolve(fakeReq({}))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError on a malformed bearer (no decodable sub)", async () => {
    await expect(
      new AlbAuthProvider(CONFIG).resolve(fakeReq({ Authorization: "Bearer not.a.jwt" }))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

// ---------------------------------------------------------------------------
// Happy-path identity extraction

describe("AlbAuthProvider — identity extraction", () => {
  it("decodes identity from Authorization: Bearer <jwt>", async () => {
    const jwt = makeJwt({
      sub: "cog-uuid",
      "cognito:username": "test_athena_1",
      email: "t@x.com",
    });
    const ctx = await new AlbAuthProvider(CONFIG).resolve(
      fakeReq({ Authorization: `Bearer ${jwt}` })
    );
    expect(ctx.userId).toBe("cog-uuid");
    expect(ctx.displayName).toBe("test_athena_1");
    expect(ctx.email).toBe("t@x.com");
  });

  it("falls back to x-amzn-oidc-data when Authorization is absent", async () => {
    const albJwt = makeJwt({ sub: "alb-sub", "cognito:username": "via_claims_mapping" });
    const ctx = await new AlbAuthProvider(CONFIG).resolve(
      fakeReq({ "x-amzn-oidc-data": albJwt })
    );
    expect(ctx.userId).toBe("alb-sub");
    expect(ctx.displayName).toBe("via_claims_mapping");
  });

  it("prefers Authorization over x-amzn-oidc-data when both are present", async () => {
    const primary = makeJwt({ sub: "from-authorization" });
    const fallback = makeJwt({ sub: "from-oidc-data" });
    const ctx = await new AlbAuthProvider(CONFIG).resolve(
      fakeReq({ Authorization: `Bearer ${primary}`, "x-amzn-oidc-data": fallback })
    );
    expect(ctx.userId).toBe("from-authorization");
  });

  it("decodes base64url payloads that require padding", async () => {
    const jwt = makeJwt({ sub: "x", "cognito:username": "pad_test_ab" });
    const ctx = await new AlbAuthProvider(CONFIG).resolve(
      fakeReq({ Authorization: `Bearer ${jwt}` })
    );
    expect(ctx.userId).toBe("x");
    expect(ctx.athena.workgroup).toBe("athena-shell-pad_test_ab");
  });
});

// ---------------------------------------------------------------------------
// AuthContext derivation — workgroup / role / DB / prefix templating

describe("AlbAuthProvider — AuthContext derivation", () => {
  it("templates workgroup, role ARN, prefix, output location, user DB from cognito:username", async () => {
    const jwt = makeJwt({ sub: "s", "cognito:username": "test_athena_1" });
    const ctx = await new AlbAuthProvider(CONFIG).resolve(
      fakeReq({ Authorization: `Bearer ${jwt}` })
    );
    expect(ctx.athena.workgroup).toBe("athena-shell-test_athena_1");
    expect(ctx.roleArn).toBe(
      "arn:aws:iam::123456789012:role/athena-shell-user-test_athena_1"
    );
    expect(ctx.athena.userDatabase).toBe("workspace_test_athena_1");
    expect(ctx.athena.defaultDatabase).toBe("workspace_test_athena_1");
    expect(ctx.s3.bucket).toBe("athena-shell-data");
    expect(ctx.s3.prefix).toBe("users/test_athena_1/");
    expect(ctx.athena.outputLocation).toBe(
      "s3://athena-shell-results/users/test_athena_1/"
    );
    expect(ctx.region).toBe("us-east-1");
  });

  it("falls back to sub for all templated names when cognito:username is missing", async () => {
    const jwt = makeJwt({ sub: "only-sub" });
    const ctx = await new AlbAuthProvider(CONFIG).resolve(
      fakeReq({ Authorization: `Bearer ${jwt}` })
    );
    expect(ctx.displayName).toBe("only-sub");
    expect(ctx.athena.workgroup).toBe("athena-shell-only-sub");
    expect(ctx.athena.userDatabase).toBe("workspace_only-sub");
    expect(ctx.s3.prefix).toBe("users/only-sub/");
  });

  it("uses email as the display-name fallback when cognito:username is missing", async () => {
    const jwt = makeJwt({ sub: "s-123", email: "fallback@example.com" });
    const ctx = await new AlbAuthProvider(CONFIG).resolve(
      fakeReq({ Authorization: `Bearer ${jwt}` })
    );
    expect(ctx.displayName).toBe("fallback@example.com");
    expect(ctx.email).toBe("fallback@example.com");
  });
});
