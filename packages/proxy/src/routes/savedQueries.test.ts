import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../aws/athenaClient.js", () => ({
  createAthenaClient: () => ({
    send: async () => ({ NamedQueryId: "nq-new" }),
  }),
}));

const { savedQueriesRouter } = await import("./savedQueries.js");
const { loadConfig } = await import("../config.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user = {
      userId: "alice",
      displayName: "alice",
      email: "alice@example.com",
      region: "us-east-1",
      roleArn: "arn:aws:iam::000:role/alice",
      s3: { bucket: "b", prefix: "p/" },
      athena: {
        workgroup: "workspace_alice",
        outputLocation: "s3://r/",
        userDatabase: "workspace_alice",
      },
    };
    next();
  });
  a.use("/saved-queries", savedQueriesRouter(loadConfig({ MOCK_AUTH: "1" })));
  return a;
}

describe("savedQueriesRouter", () => {
  it("PATCH returns 405 with an immutable-names message", async () => {
    const res = await request(app()).patch("/saved-queries/abc").send({});
    expect(res.status).toBe(405);
    expect(res.body.error.message).toMatch(/immutable/i);
  });

  it("POST 400s when name is missing", async () => {
    const res = await request(app())
      .post("/saved-queries")
      .send({ sql: "SELECT 1" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/name/i);
  });

  it("POST 400s when sql is missing", async () => {
    const res = await request(app())
      .post("/saved-queries")
      .send({ name: "daily" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/sql/i);
  });

  it("POST 400s when name has forbidden chars", async () => {
    const res = await request(app())
      .post("/saved-queries")
      .send({ name: "bad/name!", sql: "SELECT 1" });
    expect(res.status).toBe(400);
  });

  it("POST 400s when description exceeds the cap", async () => {
    const res = await request(app())
      .post("/saved-queries")
      .send({
        name: "ok",
        sql: "SELECT 1",
        description: "x".repeat(201),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/description/i);
  });

  it("POST returns the id on success", async () => {
    const res = await request(app())
      .post("/saved-queries")
      .send({ name: "daily", sql: "SELECT 1" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("nq-new");
  });
});
