import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../aws/athenaClient.js", () => ({
  createAthenaClient: () => ({
    send: async () => ({
      QueryExecution: {
        Status: {
          State: "SUCCEEDED",
          SubmissionDateTime: new Date("2026-04-01T00:00:00Z"),
        },
        Query: "SELECT 1",
        ResultConfiguration: { OutputLocation: "s3://results-bucket/exec-xyz.csv" },
        WorkGroup: "wg",
        QueryExecutionContext: { Database: "db" },
        Statistics: {},
      },
    }),
  }),
}));

vi.mock("../aws/s3Client.js", () => ({
  createS3Client: () => ({
    send: async (cmd: { constructor: { name: string } }) => {
      const n = cmd.constructor.name;
      if (n === "HeadObjectCommand") {
        throw Object.assign(new Error("not found"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        });
      }
      return {};
    },
  }),
}));

vi.mock("../services/resultsService.js", () => ({
  parseS3Url: (url: string) => {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(url);
    if (!m) throw new Error(`bad s3 url: ${url}`);
    return { bucket: m[1], key: m[2] };
  },
  presignResultsDownload: async () => "https://example.invalid/presigned?sig=fake",
}));

const { resultsRouter } = await import("./results.js");
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
      s3: { bucket: "data-bucket", prefix: "users/alice/" },
      athena: { workgroup: "wg", outputLocation: "s3://results/alice/" },
    };
    next();
  });
  a.use("/query", resultsRouter(loadConfig({ MOCK_AUTH: "1" })));
  return a;
}

describe("results save-to-workspace route", () => {
  beforeAll(() => {
    // guard against env interference
  });

  it("copies the result into the user's prefix", async () => {
    const res = await request(app())
      .post("/query/exec-xyz/save-to-workspace")
      .send({ targetKey: "users/alice/results/daily.csv" });
    expect(res.status).toBe(200);
    expect(res.body.key).toBe("users/alice/results/daily.csv");
    expect(res.body.sidecarKey).toBe("users/alice/results/daily.sql");
  });

  it("403s when targetKey falls outside the user's prefix", async () => {
    const res = await request(app())
      .post("/query/exec-xyz/save-to-workspace")
      .send({ targetKey: "users/bob/results/x.csv" });
    expect(res.status).toBe(403);
  });

  it("403s on path traversal", async () => {
    const res = await request(app())
      .post("/query/exec-xyz/save-to-workspace")
      .send({ targetKey: "users/alice/../bob/x.csv" });
    expect(res.status).toBe(403);
  });

  it("400s when targetKey is missing", async () => {
    const res = await request(app()).post("/query/exec-xyz/save-to-workspace").send({});
    expect(res.status).toBe(400);
  });

  it("honors includeSqlSidecar=false", async () => {
    const res = await request(app())
      .post("/query/exec-xyz/save-to-workspace")
      .send({ targetKey: "users/alice/out.csv", includeSqlSidecar: false });
    expect(res.status).toBe(200);
    expect(res.body.sidecarKey).toBeUndefined();
  });
});

describe("results /:id/results-url route", () => {
  it("returns a presigned URL (distinct audit event from /download)", async () => {
    const res = await request(app()).get("/query/exec-xyz/results-url");
    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe("string");
  });
});
