import {
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { parquetWriteBuffer } from "hyparquet-writer";
import { describe, expect, it } from "vitest";

import { inferSchema } from "./datasetsService.js";

/**
 * Builds a tiny Parquet buffer with `hyparquet-writer`, then returns a
 * fake S3Client whose `send()` resolves HeadObject + ranged GetObject
 * against that buffer. Exercises the full `inferSchema` → asyncBuffer
 * → hyparquet parse → Athena-type-mapping path.
 */
function fakeS3ForBuffer(buf: ArrayBuffer): S3Client {
  const bytes = new Uint8Array(buf);
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: async (cmd: any) => {
      if (cmd instanceof HeadObjectCommand) {
        return { ContentLength: bytes.byteLength };
      }
      if (cmd instanceof GetObjectCommand) {
        const range = cmd.input.Range as string | undefined;
        const slice = range ? sliceFromRange(bytes, range) : bytes;
        return {
          Body: {
            async transformToByteArray(): Promise<Uint8Array> {
              return slice;
            },
          },
        };
      }
      throw new Error(`unexpected command: ${cmd.constructor.name}`);
    },
  } as unknown as S3Client;
}

function sliceFromRange(bytes: Uint8Array, range: string): Uint8Array {
  const m = /^bytes=(\d+)-(\d+)$/.exec(range);
  if (!m) throw new Error(`unexpected range header: ${range}`);
  const start = Number(m[1]);
  const endInclusive = Number(m[2]);
  return bytes.slice(start, endInclusive + 1);
}

describe("inferSchema — parquet round-trip", () => {
  it("maps a mixed-type parquet's primitive columns to Athena types", async () => {
    const buf = parquetWriteBuffer({
      columnData: [
        { name: "id", type: "INT64", data: [1n, 2n, 3n] },
        { name: "name", type: "STRING", data: ["a", "b", "c"] },
        { name: "score", type: "DOUBLE", data: [1.5, 2.5, 3.5] },
        { name: "active", type: "BOOLEAN", data: [true, false, true] },
      ],
    });
    const s3 = fakeS3ForBuffer(buf);
    const out = await inferSchema(s3, "bucket", "key.parquet", "parquet");
    expect(out.hasHeader).toBe(false);
    const byName = Object.fromEntries(out.columns.map((c) => [c.name, c.type]));
    expect(byName.id).toBe("bigint");
    expect(byName.name).toBe("string");
    expect(byName.score).toBe("double");
    expect(byName.active).toBe("boolean");
  });
});

describe("inferSchema — json/jsonl round-trip", () => {
  function textS3(body: string): S3Client {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      send: async (_cmd: any) => ({
        Body: {
          async transformToByteArray(): Promise<Uint8Array> {
            return new TextEncoder().encode(body);
          },
        },
      }),
    } as unknown as S3Client;
  }

  it("handles jsonl files by unioning keys across records", async () => {
    const s3 = textS3('{"a":1,"b":"x"}\n{"a":2,"c":true}\n');
    const out = await inferSchema(s3, "b", "k", "jsonl");
    expect(out.columns.map((c) => c.name)).toEqual(["a", "b", "c"]);
  });

  it("handles json files with an array of records", async () => {
    const s3 = textS3('[{"x":1},{"x":2,"y":"foo"}]');
    const out = await inferSchema(s3, "b", "k", "json");
    expect(out.columns.map((c) => c.name)).toEqual(["x", "y"]);
  });
});
