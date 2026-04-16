import type { S3Listing, S3Object, UploadProgress } from "@athena-shell/shared";

import { basenameOf } from "../utils/parseS3Path";

interface StoredObject {
  key: string;
  size: number;
  lastModified: string;
  body: Blob | ArrayBuffer | string;
}

const seed = (): StoredObject[] => [
  {
    key: "users/dev/welcome.txt",
    size: 42,
    lastModified: "2026-04-15T12:00:00Z",
    body: "Welcome to athena-shell\nDrag files here to upload.\n",
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
