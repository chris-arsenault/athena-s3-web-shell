import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("uses safe defaults (mock unless AUTH_PROVIDER=alb)", () => {
    const c = loadConfig({});
    expect(c.port).toBe(8080);
    expect(c.region).toBe("us-east-1");
    expect(c.authProvider).toBe("mock");
    expect(c.mockAuth).toBe(true);
    expect(Object.keys(c.mockUsers)).toContain("dev-user");
  });

  it("AUTH_PROVIDER=alb selects the alb provider", () => {
    const c = loadConfig({
      AUTH_PROVIDER: "alb",
      AWS_ACCOUNT_ID: "111111111111",
      NAME_PREFIX: "athena-shell",
      DATA_BUCKET: "data",
      RESULTS_BUCKET: "results",
      GLUE_DATABASE: "db",
    });
    expect(c.authProvider).toBe("alb");
    expect(c.mockAuth).toBe(false);
    expect(c.alb?.dataBucket).toBe("data");
    expect(c.alb?.namePrefix).toBe("athena-shell");
    expect(c.alb?.accountId).toBe("111111111111");
  });

  it("AUTH_PROVIDER=alb without required env vars throws", () => {
    expect(() => loadConfig({ AUTH_PROVIDER: "alb" })).toThrow(
      /AUTH_PROVIDER=alb requires env vars/
    );
  });

  it("parses MOCK_USERS_JSON", () => {
    const raw = JSON.stringify({
      alice: {
        userId: "alice",
        displayName: "Alice",
        email: "a@x",
        region: "us-east-1",
        roleArn: "arn",
        s3: { bucket: "b", prefix: "p/" },
        athena: { workgroup: "wg", outputLocation: "s3://b/o/" },
      },
    });
    const c = loadConfig({ MOCK_USERS_JSON: raw });
    expect(c.mockUsers.alice?.email).toBe("a@x");
  });

  it("throws on bad JSON", () => {
    expect(() => loadConfig({ MOCK_USERS_JSON: "{not json" })).toThrow(
      /not valid JSON/
    );
  });
});
