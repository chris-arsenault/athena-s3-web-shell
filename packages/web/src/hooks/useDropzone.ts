import { useCallback, useState, type DragEvent } from "react";

export interface DroppedFile {
  file: File;
  relativePath: string;
}

async function walkEntry(entry: FileSystemEntry, base: string): Promise<DroppedFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    return new Promise((resolve, reject) =>
      fileEntry.file(
        (file) => resolve([{ file, relativePath: base + file.name }]),
        reject
      )
    );
  }
  const dirEntry = entry as FileSystemDirectoryEntry;
  const reader = dirEntry.createReader();
  const collected: DroppedFile[] = [];
  await new Promise<void>((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries(async (entries) => {
        if (entries.length === 0) return resolve();
        for (const child of entries) {
          collected.push(...(await walkEntry(child, base + dirEntry.name + "/")));
        }
        readBatch();
      }, reject);
    };
    readBatch();
  });
  return collected;
}

async function collectFromItems(items: DataTransferItemList): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]?.webkitGetAsEntry();
    if (entry) out.push(...(await walkEntry(entry, "")));
  }
  return out;
}

function collectFromFiles(files: FileList): DroppedFile[] {
  const out: DroppedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i);
    if (f) out.push({ file: f, relativePath: f.name });
  }
  return out;
}

async function collectDropped(dt: DataTransfer | null): Promise<DroppedFile[]> {
  if (!dt) return [];
  const items = dt.items;
  if (items && items.length > 0 && items[0]?.webkitGetAsEntry) {
    return collectFromItems(items);
  }
  return collectFromFiles(dt.files);
}

export function useDropzone(onFiles: (files: DroppedFile[]) => void) {
  const [active, setActive] = useState(false);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setActive(true);
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setActive(false);
  }, []);
  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setActive(false);
      const out = await collectDropped(e.dataTransfer);
      onFiles(out);
    },
    [onFiles]
  );

  return { active, dropzoneProps: { onDragOver, onDragLeave, onDrop } };
}
