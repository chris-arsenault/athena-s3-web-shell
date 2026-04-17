import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { AthenaClient } from "@aws-sdk/client-athena";
import { describe, expect, it } from "vitest";

import {
  copyResultToWorkspace,
  HttpError,
} from "./queryResultsService.js";

interface FakeCall {
  cmd: unknown;
}

interface FakeOpts {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  athenaSend: (cmd: any) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s3Send: (cmd: any) => unknown;
}

function fakes(opts: FakeOpts): {
  athena: AthenaClient;
  s3: S3Client;
  s3Calls: FakeCall[];
} {
  const s3Calls: FakeCall[] = [];
  const athena = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: async (cmd: any) => opts.athenaSend(cmd),
  } as unknown as AthenaClient;
  const s3 = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: async (cmd: any) => {
      s3Calls.push({ cmd });
      return opts.s3Send(cmd);
    },
  } as unknown as S3Client;
  return { athena, s3, s3Calls };
}

const SUCCEEDED_EXECUTION = {
  QueryExecution: {
    Status: {
      State: "SUCCEEDED",
      SubmissionDateTime: new Date("2026-04-01T00:00:00Z"),
    },
    Query: "SELECT 1",
    ResultConfiguration: { OutputLocation: "s3://results-bucket/exec-1.csv" },
    WorkGroup: "wg",
    QueryExecutionContext: { Database: "db" },
    Statistics: {},
  },
};

describe("copyResultToWorkspace — happy path", () => {
  it("copies the result CSV into the target prefix", async () => {
    const { athena, s3, s3Calls } = fakes({
      athenaSend: () => SUCCEEDED_EXECUTION,
      s3Send: (cmd) => {
        if (cmd instanceof HeadObjectCommand) {
          const err = Object.assign(new Error("not found"), {
            name: "NotFound",
            $metadata: { httpStatusCode: 404 },
          });
          throw err;
        }
        return {};
      },
    });
    const out = await copyResultToWorkspace(athena, s3, "exec-1", {
      targetBucket: "user-bucket",
      targetKey: "users/alice/results/daily.csv",
      includeSqlSidecar: false,
      overwrite: false,
    });
    expect(out.targetKey).toBe("users/alice/results/daily.csv");
    expect(out.sidecarKey).toBeUndefined();
    const copyCmd = s3Calls.find((c) => c.cmd instanceof CopyObjectCommand)!
      .cmd as CopyObjectCommand;
    expect(copyCmd.input.Bucket).toBe("user-bucket");
    expect(copyCmd.input.Key).toBe("users/alice/results/daily.csv");
    expect(copyCmd.input.CopySource).toBe("results-bucket/exec-1.csv");
  });

  it("writes a .sql sidecar when requested", async () => {
    const { athena, s3, s3Calls } = fakes({
      athenaSend: () => SUCCEEDED_EXECUTION,
      s3Send: (cmd) => {
        if (cmd instanceof HeadObjectCommand) {
          throw Object.assign(new Error("nf"), { $metadata: { httpStatusCode: 404 } });
        }
        return {};
      },
    });
    await copyResultToWorkspace(athena, s3, "exec-1", {
      targetBucket: "user-bucket",
      targetKey: "users/alice/results/daily.csv",
      includeSqlSidecar: true,
      overwrite: false,
    });
    const putCmd = s3Calls.find((c) => c.cmd instanceof PutObjectCommand)!
      .cmd as PutObjectCommand;
    expect(putCmd.input.Key).toBe("users/alice/results/daily.sql");
    expect(putCmd.input.Body).toBe("SELECT 1");
  });

});

describe("copyResultToWorkspace — guards", () => {
  it("throws 409 if target exists and overwrite=false", async () => {
    const { athena, s3 } = fakes({
      athenaSend: () => SUCCEEDED_EXECUTION,
      s3Send: (cmd) => {
        if (cmd instanceof HeadObjectCommand) return { ContentLength: 1 };
        return {};
      },
    });
    await expect(
      copyResultToWorkspace(athena, s3, "exec-1", {
        targetBucket: "user-bucket",
        targetKey: "users/alice/results/daily.csv",
        includeSqlSidecar: false,
        overwrite: false,
      })
    ).rejects.toThrow(HttpError);
  });

  it("overwrite=true skips the exists check", async () => {
    const { athena, s3, s3Calls } = fakes({
      athenaSend: () => SUCCEEDED_EXECUTION,
      s3Send: () => ({}),
    });
    await copyResultToWorkspace(athena, s3, "exec-1", {
      targetBucket: "user-bucket",
      targetKey: "users/alice/results/daily.csv",
      includeSqlSidecar: false,
      overwrite: true,
    });
    expect(s3Calls.some((c) => c.cmd instanceof HeadObjectCommand)).toBe(false);
    expect(s3Calls.some((c) => c.cmd instanceof CopyObjectCommand)).toBe(true);
  });

  it("refuses to copy when the query is not SUCCEEDED", async () => {
    const { athena, s3 } = fakes({
      athenaSend: () => ({
        QueryExecution: {
          Status: { State: "RUNNING", SubmissionDateTime: new Date() },
          Query: "",
          ResultConfiguration: { OutputLocation: "s3://r/exec.csv" },
        },
      }),
      s3Send: () => ({}),
    });
    await expect(
      copyResultToWorkspace(athena, s3, "exec-1", {
        targetBucket: "user-bucket",
        targetKey: "users/alice/results/x.csv",
        includeSqlSidecar: false,
        overwrite: true,
      })
    ).rejects.toThrow(/SUCCEEDED/);
  });
});
