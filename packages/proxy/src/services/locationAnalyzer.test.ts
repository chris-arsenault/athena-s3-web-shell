import { describe, expect, it } from "vitest";

import type { AuthContext } from "@athena-shell/shared";

import { analyzeLocation } from "./locationAnalyzer.js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeGlue(tables: Array<{ name: string; location: string }> = []): any {
  return {
    send: async (cmd: { constructor: { name: string } }) => {
      const n = cmd.constructor.name;
      if (n === "GetTablesCommand") {
        return {
          TableList: tables.map((t) => ({
            Name: t.name,
            StorageDescriptor: { Location: t.location },
          })),
        };
      }
      return {};
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeS3(siblings: Array<{ Key: string; Size: number }>): any {
  return {
    send: async (cmd: { constructor: { name: string } }) => {
      const n = cmd.constructor.name;
      if (n === "ListObjectsV2Command") {
        return { Contents: siblings };
      }
      return {};
    },
  };
}

describe("analyzeLocation — outside /datasets/", () => {
  it("plans a move to datasets/<sanitized-table>/", async () => {
    const out = await analyzeLocation(
      fakeS3([]),
      fakeGlue(),
      CTX,
      { bucket: "data-bucket", key: "users/alice/reports/sales-2025.csv" },
      "sales_2025"
    );
    expect(out.plan.strategy).toBe("move");
    expect(out.plan.finalLocation).toBe(
      "s3://data-bucket/users/alice/datasets/sales_2025/"
    );
    expect(out.findings).toEqual([]);
  });

  it("blocks when an existing table already points at the target datasets dir", async () => {
    const out = await analyzeLocation(
      fakeS3([]),
      fakeGlue([
        {
          name: "sales_2025",
          location: "s3://data-bucket/users/alice/datasets/sales_2025/",
        },
      ]),
      CTX,
      { bucket: "data-bucket", key: "users/alice/reports/sales-2025.csv" },
      "sales_2025"
    );
    expect(out.plan.strategy).toBe("blocked");
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.kind).toBe("duplicate-table");
  });

  it("treats a file directly in /datasets/ (no subdir) as outside — move into proper subdir", async () => {
    const out = await analyzeLocation(
      fakeS3([]),
      fakeGlue(),
      CTX,
      { bucket: "data-bucket", key: "users/alice/datasets/orphan.csv" },
      "orphan"
    );
    expect(out.plan.strategy).toBe("move");
    expect(out.plan.finalLocation).toBe(
      "s3://data-bucket/users/alice/datasets/orphan/"
    );
  });
});

describe("analyzeLocation — inside /datasets/<dir>/", () => {
  it("plans in-place when siblings are clean", async () => {
    const out = await analyzeLocation(
      fakeS3([
        { Key: "users/alice/datasets/sales_2025/sales-2025.csv", Size: 1_000_000 },
        { Key: "users/alice/datasets/sales_2025/sales-2024.csv", Size: 2_000_000 },
      ]),
      fakeGlue(),
      CTX,
      {
        bucket: "data-bucket",
        key: "users/alice/datasets/sales_2025/sales-2025.csv",
      },
      "sales_2025"
    );
    expect(out.plan.strategy).toBe("in-place");
    expect(out.plan.finalLocation).toBe(
      "s3://data-bucket/users/alice/datasets/sales_2025/"
    );
    expect(out.findings).toEqual([]);
  });

  it("blocks on mixed parent when extensions differ", async () => {
    const out = await analyzeLocation(
      fakeS3([
        { Key: "users/alice/datasets/mixed/a.csv", Size: 10_000 },
        { Key: "users/alice/datasets/mixed/b.json", Size: 8_000 },
      ]),
      fakeGlue(),
      CTX,
      { bucket: "data-bucket", key: "users/alice/datasets/mixed/a.csv" },
      "mixed"
    );
    expect(out.plan.strategy).toBe("blocked");
    expect(out.findings[0]?.kind).toBe("mixed-parent");
  });

  it("blocks on mixed parent when a sibling is an artifact (< 128 bytes)", async () => {
    const out = await analyzeLocation(
      fakeS3([
        { Key: "users/alice/datasets/small/a.csv", Size: 10_000 },
        { Key: "users/alice/datasets/small/.DS_Store", Size: 6 },
      ]),
      fakeGlue(),
      CTX,
      { bucket: "data-bucket", key: "users/alice/datasets/small/a.csv" },
      "small"
    );
    expect(out.plan.strategy).toBe("blocked");
    expect(out.findings[0]?.kind).toBe("mixed-parent");
  });

});

describe("analyzeLocation — duplicate-table in /datasets/<dir>/", () => {
  it("blocks with duplicate-table (preferred over mixed detection when both apply)", async () => {
    const out = await analyzeLocation(
      fakeS3([
        { Key: "users/alice/datasets/sales_2025/sales-2025.csv", Size: 10_000 },
      ]),
      fakeGlue([
        {
          name: "sales_2025",
          location: "s3://data-bucket/users/alice/datasets/sales_2025",
        },
      ]),
      CTX,
      {
        bucket: "data-bucket",
        key: "users/alice/datasets/sales_2025/sales-2025.csv",
      },
      "sales_2025"
    );
    expect(out.plan.strategy).toBe("blocked");
    expect(out.findings[0]?.kind).toBe("duplicate-table");
  });

  it("normalizes trailing slash when comparing locations", async () => {
    const out = await analyzeLocation(
      fakeS3([
        { Key: "users/alice/datasets/sales_2025/sales-2025.csv", Size: 10_000 },
      ]),
      // note: existing table stored WITHOUT trailing slash
      fakeGlue([
        {
          name: "sales_2025",
          location: "s3://data-bucket/users/alice/datasets/sales_2025",
        },
      ]),
      CTX,
      {
        bucket: "data-bucket",
        key: "users/alice/datasets/sales_2025/sales-2025.csv",
      },
      "sales_2025"
    );
    expect(out.plan.strategy).toBe("blocked");
    expect(out.findings[0]?.kind).toBe("duplicate-table");
  });
});

describe("analyzeLocation — security", () => {
  it("throws on bucket mismatch", async () => {
    await expect(
      analyzeLocation(fakeS3([]), fakeGlue(), CTX, {
        bucket: "other-bucket",
        key: "users/alice/reports/x.csv",
      }, "x")
    ).rejects.toThrow(/workspace bucket/);
  });

  it("throws on out-of-prefix key", async () => {
    await expect(
      analyzeLocation(fakeS3([]), fakeGlue(), CTX, {
        bucket: "data-bucket",
        key: "users/bob/reports/x.csv",
      }, "x")
    ).rejects.toThrow(/workspace prefix/);
  });

  it("throws on path traversal", async () => {
    await expect(
      analyzeLocation(fakeS3([]), fakeGlue(), CTX, {
        bucket: "data-bucket",
        key: "users/alice/../bob/x.csv",
      }, "x")
    ).rejects.toThrow(/path traversal/);
  });
});
