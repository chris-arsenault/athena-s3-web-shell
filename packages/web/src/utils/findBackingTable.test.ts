import { describe, expect, it } from "vitest";

import type { TableRef } from "@athena-shell/shared";

import { findBackingTable } from "./findBackingTable";

const TABLES: TableRef[] = [
  {
    name: "sales",
    database: "workspace_alice",
    location: "s3://data-bucket/users/alice/sales/",
  },
  {
    name: "orders",
    database: "workspace_alice",
    location: "s3://data-bucket/users/alice/sales/orders/",
  },
  {
    name: "other",
    database: "shared",
    location: "s3://data-bucket/public/other/",
  },
  {
    name: "no_location",
    database: "shared",
  },
];

describe("findBackingTable", () => {
  it("matches a file under a table's LOCATION", () => {
    const hit = findBackingTable(
      "users/alice/sales/2024.parquet",
      "data-bucket",
      TABLES
    );
    expect(hit).toMatchObject({ database: "workspace_alice", table: "sales" });
  });

  it("matches the directory itself (trailing slash)", () => {
    const hit = findBackingTable("users/alice/sales/", "data-bucket", TABLES);
    expect(hit?.table).toBe("sales");
  });

  it("picks the most specific table when prefixes nest", () => {
    const hit = findBackingTable(
      "users/alice/sales/orders/2024.parquet",
      "data-bucket",
      TABLES
    );
    expect(hit?.table).toBe("orders");
  });

  it("returns null when no table covers the key", () => {
    expect(
      findBackingTable("users/alice/other/file.csv", "data-bucket", TABLES)
    ).toBeNull();
  });

  it("returns null when the bucket doesn't match", () => {
    expect(
      findBackingTable("users/alice/sales/x.csv", "other-bucket", TABLES)
    ).toBeNull();
  });

  it("ignores tables without a location", () => {
    const hit = findBackingTable(
      "users/alice/sales/2024.parquet",
      "data-bucket",
      [{ name: "no_location", database: "shared" }]
    );
    expect(hit).toBeNull();
  });
});
