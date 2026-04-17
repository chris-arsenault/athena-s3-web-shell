import type { GlueClient } from "@aws-sdk/client-glue";
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import type { AuthContext } from "@athena-shell/shared";

import { analyzeDataset } from "./analyzeService.js";

const CTX: AuthContext = {
  userId: "alice",
  displayName: "alice",
  email: "alice@example.com",
  region: "us-east-1",
  roleArn: "arn:aws:iam::000:role/alice",
  s3: { bucket: "data-bucket", prefix: "users/alice/" },
  athena: {
    workgroup: "wg",
    outputLocation: "s3://results/alice/",
    userDatabase: "workspace_alice",
  },
};

function fakeGlue(tables: Array<{ name: string; location: string }> = []): GlueClient {
  return {
    send: async (cmd: { constructor: { name: string } }) =>
      cmd.constructor.name === "GetTablesCommand"
        ? {
            TableList: tables.map((t) => ({
              Name: t.name,
              StorageDescriptor: { Location: t.location },
            })),
          }
        : {},
  } as unknown as GlueClient;
}

function fakeS3({
  csv,
  siblings = [],
}: {
  csv?: string;
  siblings?: Array<{ Key: string; Size: number }>;
}): S3Client {
  return {
    send: async (cmd: { constructor: { name: string } }) => {
      const n = cmd.constructor.name;
      if (n === "ListObjectsV2Command") return { Contents: siblings };
      if (n === "GetObjectCommand") {
        const text = csv ?? "";
        const bytes = new TextEncoder().encode(text);
        return {
          Body: {
            transformToByteArray: async () => bytes,
          },
        };
      }
      return {};
    },
  } as unknown as S3Client;
}

describe("analyzeDataset — CSV happy path", () => {
  it("returns move plan + null-token finding for a CSV outside /datasets/", async () => {
    // Inference widens both columns to STRING when it sees `not-a-date`
    // / `N/A`, so no type-mismatch fires. What *does* fire is the null-
    // token detector: `N/A` appears in ≥20% of rows in `amount`.
    const csv = [
      "subscription_date,amount",
      "2024-01-15,100",
      "2024-02-15,N/A",
      "2024-03-15,N/A",
      "2024-04-15,200",
      "2024-05-15,N/A",
    ].join("\n");
    const out = await analyzeDataset(
      fakeS3({ csv, siblings: [] }),
      fakeGlue(),
      CTX,
      {
        bucket: "data-bucket",
        key: "users/alice/reports/sales.csv",
        fileType: "csv",
        table: "sales_2025",
      }
    );
    expect(out.location.strategy).toBe("move");
    expect(out.location.finalLocation).toBe(
      "s3://data-bucket/users/alice/datasets/sales_2025/"
    );
    expect(out.columns.map((c) => c.name)).toEqual([
      "subscription_date",
      "amount",
    ]);
    expect(out.findings.some((f) => f.kind === "null-token")).toBe(true);
  });
});

describe("analyzeDataset — block scenarios", () => {
  it("returns json-array block for a top-level JSON array", async () => {
    const out = await analyzeDataset(
      fakeS3({ csv: "[{\"x\":1},{\"x\":2}]", siblings: [] }),
      fakeGlue(),
      CTX,
      {
        bucket: "data-bucket",
        key: "users/alice/reports/data.json",
        fileType: "json",
        table: "data",
      }
    );
    const block = out.findings.find((f) => f.kind === "json-array");
    expect(block).toBeDefined();
    expect(block?.severity).toBe("block");
  });

  it("propagates duplicate-table block from location analysis", async () => {
    const out = await analyzeDataset(
      fakeS3({ csv: "a,b\n1,2\n", siblings: [] }),
      fakeGlue([
        {
          name: "sales_2025",
          location: "s3://data-bucket/users/alice/datasets/sales_2025/",
        },
      ]),
      CTX,
      {
        bucket: "data-bucket",
        key: "users/alice/reports/sales.csv",
        fileType: "csv",
        table: "sales_2025",
      }
    );
    expect(out.location.strategy).toBe("blocked");
    expect(out.findings.some((f) => f.kind === "duplicate-table")).toBe(true);
  });
});

describe("analyzeDataset — null-token", () => {
  it("flags 'N/A' tokens in a clean STRING column", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      i % 3 === 0 ? "status\nN/A" : "status\nok"
    );
    const csv =
      "status\n" +
      Array.from({ length: 10 }, (_, i) => (i % 3 === 0 ? "N/A" : "ok")).join(
        "\n"
      );
    void rows;
    const out = await analyzeDataset(fakeS3({ csv, siblings: [] }), fakeGlue(), CTX, {
      bucket: "data-bucket",
      key: "users/alice/reports/status.csv",
      fileType: "csv",
      table: "status",
    });
    const nt = out.findings.find((f) => f.kind === "null-token");
    expect(nt).toBeDefined();
  });
});
