import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("uses safe defaults", () => {
    const c = loadConfig({});
    expect(c.port).toBe(8080);
    expect(c.region).toBe("us-east-1");
    expect(c.mockAuth).toBe(false);
    expect(Object.keys(c.mockUsers)).toContain("dev-user");
  });

  it("parses MOCK_AUTH=1 as true", () => {
    expect(loadConfig({ MOCK_AUTH: "1" }).mockAuth).toBe(true);
    expect(loadConfig({ MOCK_AUTH: "true" }).mockAuth).toBe(true);
    expect(loadConfig({ MOCK_AUTH: "0" }).mockAuth).toBe(false);
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
