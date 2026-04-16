import { describe, expect, it } from "vitest";
import request from "supertest";

import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

function devApp() {
  return createServer(loadConfig({ MOCK_AUTH: "1" }));
}

describe("server routes", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(devApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /api/session returns the resolved AuthContext", async () => {
    const res = await request(devApp()).get("/api/session");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("dev-user");
    expect(res.body.s3.bucket).toBe("athena-shell-dev");
    expect(res.body.athena.workgroup).toBe("primary");
  });

  it("rejects unknown mock user with 401", async () => {
    const res = await request(devApp())
      .get("/api/session")
      .set("X-Mock-User", "nobody");
    expect(res.status).toBe(401);
  });

  it("POST /api/query 400s without sql", async () => {
    const res = await request(devApp()).post("/api/query").send({});
    expect(res.status).toBe(400);
  });
});
