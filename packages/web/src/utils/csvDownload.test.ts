import { describe, expect, it } from "vitest";

import { resultsToCsv } from "./csvDownload";

describe("resultsToCsv", () => {
  it("renders header + rows", () => {
    const csv = resultsToCsv({
      columns: [
        { name: "id", type: "int" },
        { name: "name", type: "string" },
      ],
      rows: [
        ["1", "alice"],
        ["2", "bob"],
      ],
    });
    expect(csv).toBe("id,name\n1,alice\n2,bob\n");
  });
  it("escapes commas, quotes, newlines", () => {
    const csv = resultsToCsv({
      columns: [{ name: "x", type: "string" }],
      rows: [["a,b"], ['he said "hi"'], ["line\n2"]],
    });
    expect(csv).toBe('x\n"a,b"\n"he said ""hi"""\n"line\n2"\n');
  });
  it("renders header-only when no rows", () => {
    const csv = resultsToCsv({ columns: [{ name: "id", type: "int" }], rows: [] });
    expect(csv).toBe("id\n");
  });
});
