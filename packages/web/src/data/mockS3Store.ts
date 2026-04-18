import type { S3Listing, S3Object, UploadProgress } from "@athena-shell/shared";

import { basenameOf } from "../utils/parseS3Path";

interface StoredObject {
  key: string;
  size: number;
  lastModified: string;
  body: Blob | ArrayBuffer | string;
}

// A minimal 1×1 transparent PNG (smallest valid encoding).
const TINY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const seed = (): StoredObject[] => [
  {
    key: "users/dev/welcome.txt",
    size: 42,
    lastModified: "2026-04-15T12:00:00Z",
    body: "Welcome to athena-shell\nDrag files here to upload.\n",
  },
  {
    key: "users/dev/config.json",
    size: 80,
    lastModified: "2026-04-13T10:00:00Z",
    body: '{"name":"athena-shell","version":"0.1.0","flags":{"multiStmt":true,"savedQueries":true}}',
  },
  {
    key: "users/dev/events.jsonl",
    size: 120,
    lastModified: "2026-04-13T11:00:00Z",
    body:
      '{"id":1,"level":"info","msg":"boot"}\n{"id":2,"level":"warn","msg":"slow"}\n{"id":3,"level":"error","msg":"failed"}',
  },
  {
    key: "users/dev/pixel.png",
    size: TINY_PNG_BYTES.byteLength,
    lastModified: "2026-04-13T12:00:00Z",
    body: TINY_PNG_BYTES.buffer.slice(
      TINY_PNG_BYTES.byteOffset,
      TINY_PNG_BYTES.byteOffset + TINY_PNG_BYTES.byteLength
    ),
  },
  {
    key: "users/dev/not-really.parquet",
    size: 8,
    lastModified: "2026-04-13T13:00:00Z",
    // Not a real parquet — just enough to exercise the dispatch and let
    // the UI render the "failed to parse" error path.
    body: new Uint8Array([0x50, 0x41, 0x52, 0x31, 0, 0, 0, 0]).buffer,
  },
  {
    key: "users/dev/sample-data/sales-2025.csv",
    size: 1280,
    lastModified: "2026-04-10T09:30:00Z",
    body:
      "id,date,amount\n1,2025-01-01,42.50\n2,2025-01-02,18.75\n3,2025-01-03,99.99\n",
  },
  {
    key: "users/dev/sample-data/customers.csv",
    size: 320,
    lastModified: "2026-04-12T11:15:00Z",
    body: "id,name,email\n1,Alice,a@x.com\n2,Bob,b@x.com\n",
  },
  {
    // Messy CSV — demonstrates the auto-STRING-override heuristic:
    // `subscription_date` has a regex-valid but semantically invalid
    // row (2024-00-31) and `amount` has a value past Number.MAX_SAFE_INTEGER.
    // Modal opens with both columns pre-overridden to STRING.
    key: "users/dev/sample-data/dirty-orders.csv",
    size: 240,
    lastModified: "2026-04-14T08:00:00Z",
    body:
      "order_id,subscription_date,amount\n" +
      "1001,2024-01-15,100\n" +
      "1002,2024-02-15,9999999999999999999\n" +
      "1003,2024-00-31,200\n",
  },
  {
    key: "users/dev/sample-data/products.csv",
    size: 620,
    lastModified: "2026-04-11T14:20:00Z",
    body:
      "sku,name,category,list_price,in_stock\n" +
      "SKU-0001,Widget,hardware,12.50,true\n" +
      "SKU-0002,Gadget,hardware,34.99,true\n" +
      "SKU-0003,Sprocket,hardware,7.25,false\n" +
      "SKU-0004,Manifold,industrial,249.00,true\n" +
      "SKU-0005,Flange,industrial,89.40,true\n" +
      "SKU-0006,Coupler,industrial,15.75,true\n" +
      "SKU-0007,Valve,industrial,62.10,false\n",
  },
  {
    key: "users/dev/sample-data/region-sales.csv",
    size: 480,
    lastModified: "2026-04-09T16:45:00Z",
    body:
      "region,quarter,revenue_usd,units\n" +
      "NORTH,2026Q1,184250.00,1420\n" +
      "SOUTH,2026Q1,92140.50,812\n" +
      "EAST,2026Q1,156780.25,1290\n" +
      "WEST,2026Q1,211050.75,1683\n" +
      "NORTH,2025Q4,172900.00,1385\n" +
      "SOUTH,2025Q4,88410.50,760\n",
  },
  {
    key: "users/dev/reports/q1-rollup.csv",
    size: 340,
    lastModified: "2026-04-08T09:00:00Z",
    body:
      "metric,value,delta_pct\n" +
      "revenue_usd,644221.50,12.4\n" +
      "orders,5205,8.7\n" +
      "avg_order_usd,123.77,3.4\n" +
      "active_customers,1842,15.2\n",
  },
  {
    key: "users/dev/reports/weekly-active.csv",
    size: 280,
    lastModified: "2026-04-16T07:15:00Z",
    body:
      "week_of,dau_avg,wau,mau\n" +
      "2026-03-23,1420,6800,22400\n" +
      "2026-03-30,1485,7120,22910\n" +
      "2026-04-06,1542,7380,23180\n" +
      "2026-04-13,1601,7640,23520\n",
  },
  {
    key: "users/dev/exports/",
    size: 0,
    lastModified: "2026-04-17T00:00:00Z",
    body: "",
  },
  {
    key: "users/dev/queries/daily-rollup.sql",
    size: 380,
    lastModified: "2026-04-17T14:30:00Z",
    body:
      "-- Daily revenue rollup by region.\n" +
      "-- Usage: set :start_date before running.\n" +
      "SELECT\n" +
      "  region,\n" +
      "  DATE_TRUNC('day', order_date) AS day,\n" +
      "  COUNT(*) AS orders,\n" +
      "  SUM(amount) AS revenue_usd\n" +
      "FROM sales.orders\n" +
      "WHERE order_date >= DATE '2026-04-01'\n" +
      "GROUP BY 1, 2\n" +
      "ORDER BY day DESC, revenue_usd DESC;\n",
  },
  {
    key: "users/dev/queries/cohort-funnel.sql",
    size: 220,
    lastModified: "2026-04-14T11:00:00Z",
    body:
      "-- Signup → first-order conversion by cohort week.\n" +
      "SELECT\n" +
      "  DATE_TRUNC('week', u.created_at) AS cohort,\n" +
      "  COUNT(DISTINCT u.id) AS signups,\n" +
      "  COUNT(DISTINCT o.customer_id) AS converted\n" +
      "FROM default.users u\n" +
      "LEFT JOIN sales.orders o ON o.customer_id = u.id\n" +
      "GROUP BY 1\n" +
      "ORDER BY cohort DESC;\n",
  },
];

class MockS3Store {
  private store: StoredObject[] = seed();

  list(prefix: string): S3Listing {
    const folders = new Set<string>();
    const objects: S3Object[] = [];
    for (const obj of this.store) {
      if (!obj.key.startsWith(prefix)) continue;
      const rest = obj.key.slice(prefix.length);
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        objects.push({
          key: obj.key,
          name: basenameOf(obj.key),
          size: obj.size,
          lastModified: obj.lastModified,
        });
      } else {
        folders.add(prefix + rest.slice(0, slashIdx + 1));
      }
    }
    return {
      prefix,
      parents: [],
      folders: [...folders].sort().map((k) => ({ key: k, name: basenameOf(k) })),
      objects: objects.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async put(key: string, body: Blob | ArrayBuffer | string, size: number): Promise<void> {
    this.delete(key);
    this.store.push({ key, size, lastModified: new Date().toISOString(), body });
  }

  delete(key: string): void {
    this.store = this.store.filter((o) => o.key !== key);
  }

  async get(key: string): Promise<Blob> {
    const obj = this.store.find((o) => o.key === key);
    if (!obj) throw new Error(`Not found: ${key}`);
    if (obj.body instanceof Blob) return obj.body;
    if (typeof obj.body === "string") return new Blob([obj.body]);
    return new Blob([obj.body]);
  }

  async getText(key: string): Promise<string> {
    const obj = this.store.find((o) => o.key === key);
    if (!obj) throw new Error(`Not found: ${key}`);
    if (typeof obj.body === "string") return obj.body;
    if (obj.body instanceof ArrayBuffer) return new TextDecoder().decode(obj.body);
    if (obj.body instanceof Blob) return await obj.body.text();
    return "";
  }

  exists(key: string): boolean {
    return this.store.some((o) => o.key === key);
  }

  copy(sourceKey: string, targetKey: string): void {
    const src = this.store.find((o) => o.key === sourceKey);
    if (!src) throw new Error(`Copy source not found: ${sourceKey}`);
    const existing = this.store.findIndex((o) => o.key === targetKey);
    const rec: StoredObject = {
      key: targetKey,
      size: src.size,
      lastModified: new Date().toISOString(),
      body: src.body,
    };
    if (existing >= 0) this.store[existing] = rec;
    else this.store.push(rec);
  }

  mkdir(key: string): void {
    if (!key.endsWith("/")) key += "/";
    if (this.store.some((o) => o.key === key)) return;
    this.store.push({
      key,
      size: 0,
      lastModified: new Date().toISOString(),
      body: "",
    });
  }
}

export const mockS3 = new MockS3Store();

export function simulateUploadProgress(
  upload: UploadProgress,
  size: number,
  onUpdate: (next: UploadProgress) => void
): Promise<void> {
  return new Promise((resolve) => {
    let uploaded = 0;
    const step = Math.max(1, Math.floor(size / 8));
    const tick = () => {
      uploaded = Math.min(size, uploaded + step);
      onUpdate({
        ...upload,
        uploaded,
        status: uploaded >= size ? "succeeded" : "uploading",
      });
      if (uploaded < size) setTimeout(tick, 80);
      else resolve();
    };
    setTimeout(tick, 80);
  });
}
