export interface S3Object {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  etag?: string;
  storageClass?: string;
}

export interface S3Folder {
  key: string;
  name: string;
}

export interface S3Listing {
  prefix: string;
  parents: string[];
  folders: S3Folder[];
  objects: S3Object[];
  nextToken?: string;
}

export type UploadStatus = "pending" | "uploading" | "succeeded" | "failed" | "cancelled";

export interface UploadProgress {
  id: string;
  filename: string;
  key: string;
  size: number;
  uploaded: number;
  status: UploadStatus;
  error?: string;
}
