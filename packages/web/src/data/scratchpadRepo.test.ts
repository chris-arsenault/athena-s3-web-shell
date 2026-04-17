import { describe, expect, it } from "vitest";

import type { AuthContext } from "@athena-shell/shared";

import {
  deleteScratchpad,
  listScratchpadFiles,
  readScratchpad,
  renameScratchpad,
  scratchpadPrefix,
  validateScratchpadKey,
  writeScratchpad,
} from "./scratchpadRepo";
import { MockAuthProvider } from "../auth/MockAuthProvider";
import { mockS3 } from "./mockS3Store";

const CTX: AuthContext = {
  userId: "dev",
  displayName: "dev",
  email: "dev@example.com",
  region: "us-east-1",
  roleArn: "arn:aws:iam::000:role/dev",
  s3: { bucket: "athena-shell-dev", prefix: "users/dev/" },
  athena: {
    workgroup: "primary",
    outputLocation: "s3://athena-shell-dev/_athena/dev/",
    defaultDatabase: "default",
    userDatabase: "workspace_dev_user",
  },
};

const provider = new MockAuthProvider();

function clean(): void {
  const root = scratchpadPrefix(CTX);
  for (const o of mockS3.list(root).objects) mockS3.delete(o.key);
}

describe("validateScratchpadKey", () => {
  it("accepts a regular .sql file under the prefix", () => {
    expect(() =>
      validateScratchpadKey(CTX, "users/dev/queries/daily.sql")
    ).not.toThrow();
  });
  it("rejects keys outside the scratchpad prefix", () => {
    expect(() =>
      validateScratchpadKey(CTX, "users/dev/notes.sql")
    ).toThrow();
  });
  it("rejects non-sql files", () => {
    expect(() =>
      validateScratchpadKey(CTX, "users/dev/queries/daily.txt")
    ).toThrow();
  });
  it("rejects `..` path traversal", () => {
    expect(() =>
      validateScratchpadKey(CTX, "users/dev/queries/../other.sql")
    ).toThrow();
  });
});

describe("scratchpad CRUD (mock)", () => {
  it("round-trips write + read + list + delete", async () => {
    clean();
    const key = "users/dev/queries/first.sql";
    await writeScratchpad(provider, CTX, key, "SELECT 1");
    const list = await listScratchpadFiles(provider, CTX);
    expect(list.map((f) => f.name)).toEqual(["first.sql"]);
    const read = await readScratchpad(provider, CTX, key);
    expect(read.content).toBe("SELECT 1");
    await deleteScratchpad(provider, CTX, key);
    expect((await listScratchpadFiles(provider, CTX)).length).toBe(0);
  });

  it("rename moves the file via copy + delete", async () => {
    clean();
    const a = "users/dev/queries/a.sql";
    const b = "users/dev/queries/b.sql";
    await writeScratchpad(provider, CTX, a, "SELECT 2");
    await renameScratchpad(provider, CTX, a, b);
    const list = await listScratchpadFiles(provider, CTX);
    expect(list.map((f) => f.name)).toEqual(["b.sql"]);
    expect((await readScratchpad(provider, CTX, b)).content).toBe("SELECT 2");
  });

  it("write with If-Match detects an external change (etag mismatch)", async () => {
    clean();
    const key = "users/dev/queries/race.sql";
    await writeScratchpad(provider, CTX, key, "v1");
    const initial = await readScratchpad(provider, CTX, key);
    // Simulate external modification — bumps the mock etag because it's
    // derived from lastModified.
    await new Promise((r) => setTimeout(r, 5));
    await writeScratchpad(provider, CTX, key, "external");
    await expect(
      writeScratchpad(provider, CTX, key, "mine", initial.etag)
    ).rejects.toMatchObject({ code: "etag_mismatch" });
  });
});
